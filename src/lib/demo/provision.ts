import "server-only";
import { prisma } from "@/lib/prisma";
import {
  createIdentity,
  deleteIdentity,
  findIdentityByEmail,
  setPassword,
  setRole,
} from "@/lib/auth/identity";
import { schoolHeadSyntheticEmail } from "@/lib/auth/synthetic-email";
import {
  DEMO_ADDRESS,
  DEMO_DISTRICT_NAME,
  DEMO_DIVISION,
  DEMO_REGION,
  DEMO_SCHOOLS,
  DEMO_SCHOOL_ID_CODE,
  type DemoSchoolSpec,
} from "@/lib/demo/constants";
import { deleteSchoolCompletely } from "@/lib/demo/teardown";
import { AppError } from "@/lib/errors/app-error";

export type DemoSchoolStatus = {
  name: string;
  exists: boolean;
  schoolId: string | null;
  /** The School Head's synthetic login email, for the Super Admin's reference. */
  schoolHeadEmail: string;
};

export type DemoStatus = {
  /** True once every demo school in `DEMO_SCHOOLS` exists. */
  complete: boolean;
  /** True once at least one does — a partly built set still needs the button. */
  any: boolean;
  districtName: string;
  /** Shared by all demo schools; also each School Head's first-login password. */
  schoolIdCode: string;
  schools: DemoSchoolStatus[];
};

/**
 * Every demo school, identified by `isDemo` rather than by name.
 *
 * Name matching would be fragile in exactly the way that matters here: a School
 * Head can rename their own school from the school profile form, and these are
 * real accounts that get driven live during the recording. A renamed demo school
 * must still be recognisable as demo data.
 */
export async function findDemoSchools() {
  return prisma.school.findMany({
    where: { isDemo: true, deletedAt: null },
    select: { id: true, name: true, schoolIdCode: true, createdAt: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Match a stored school back to its spec by the School Head's email, not by
 * name — for the same rename reason above. The email is derived from the spec's
 * `emailCode` and never changes for a synthetic account.
 */
async function specIdByEmail(): Promise<Map<string, string>> {
  const heads = await prisma.user.findMany({
    where: { role: "SCHOOL_HEAD", deletedAt: null, school: { isDemo: true } },
    select: { email: true, schoolId: true },
  });
  const bySchoolId = new Map<string, string>();
  for (const head of heads) {
    if (head.schoolId) bySchoolId.set(head.email.toLowerCase(), head.schoolId);
  }
  return bySchoolId;
}

export async function demoStatus(): Promise<DemoStatus> {
  const byEmail = await specIdByEmail();

  const schools: DemoSchoolStatus[] = DEMO_SCHOOLS.map((spec) => {
    const email = schoolHeadSyntheticEmail(spec.emailCode);
    const schoolId = byEmail.get(email.toLowerCase()) ?? null;
    return { name: spec.name, exists: Boolean(schoolId), schoolId, schoolHeadEmail: email };
  });

  return {
    complete: schools.every((s) => s.exists),
    any: schools.some((s) => s.exists),
    districtName: DEMO_DISTRICT_NAME,
    schoolIdCode: DEMO_SCHOOL_ID_CODE,
    schools,
  };
}

export type ProvisionedSchool = { name: string; schoolId: string; schoolHeadEmail: string };

export type ProvisionResult =
  | { ok: true; schools: ProvisionedSchool[]; initialPassword: string }
  | { ok: false; error: string };

/**
 * Create one demo school and its School Head.
 *
 * The first-login password is the School ID and `mustChangePassword` is true —
 * identical to `createSchool`, because the video teaches that flow and a demo
 * that skipped the change-password prompt would be teaching a screen that does
 * not exist for real schools.
 */
async function provisionOne(
  spec: DemoSchoolSpec,
  createdById: string
): Promise<{ ok: true; school: ProvisionedSchool } | { ok: false; error: string }> {
  const syntheticEmail = schoolHeadSyntheticEmail(spec.emailCode);

  // `School.name` is globally unique and, unlike `schoolIdCode`, has no demo
  // exemption. A real school holding this name is the admin's to rename.
  const nameClash = await prisma.school.findFirst({
    where: { name: spec.name, isDemo: false },
    select: { id: true },
  });
  if (nameClash) {
    return { ok: false, error: `Another school is already named "${spec.name}". Rename it first.` };
  }

  // A reset leaves no identity behind, but a half-failed create can. Reuse it
  // rather than failing on "email already in use".
  let authId: string;
  try {
    const found = await findIdentityByEmail(syntheticEmail);
    if (found) {
      authId = found.authId;
      await setPassword(authId, DEMO_SCHOOL_ID_CODE);
      await setRole(authId, "SCHOOL_HEAD");
    } else {
      ({ authId } = await createIdentity({
        email: syntheticEmail,
        password: DEMO_SCHOOL_ID_CODE,
        role: "SCHOOL_HEAD",
        emailVerified: true,
      }));
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError("AUTH_PROVIDER_ERROR", {
      cause: err,
      detail: `demo provision: preparing the School Head identity failed: ${err instanceof Error ? err.message : "unknown"}`,
    });
  }

  const school = await prisma.$transaction(async (tx) => {
    const created = await tx.school.create({
      data: {
        name: spec.name,
        schoolIdCode: DEMO_SCHOOL_ID_CODE,
        address: DEMO_ADDRESS,
        region: DEMO_REGION,
        division: DEMO_DIVISION,
        district: DEMO_DISTRICT_NAME,
        isDemo: true,
        createdById,
      },
    });

    await tx.user.upsert({
      where: { authId },
      create: {
        authId,
        email: syntheticEmail,
        role: "SCHOOL_HEAD",
        schoolId: created.id,
        firstName: "",
        lastName: "",
        fullName: created.name,
        isActive: true,
        mustChangePassword: true,
        // The password set above IS `schoolIdCode`. Recording that is what lets
        // the Super Admin console show a working credential later.
        passwordIsSchoolId: true,
        profileCompleted: false,
      },
      update: {
        email: syntheticEmail,
        role: "SCHOOL_HEAD",
        schoolId: created.id,
        isActive: true,
        deletedAt: null,
        mustChangePassword: true,
        passwordIsSchoolId: true,
        profileCompleted: false,
      },
    });

    return created;
  });

  return {
    ok: true,
    school: { name: school.name, schoolId: school.id, schoolHeadEmail: syntheticEmail },
  };
}

/**
 * Create every demo school that does not already exist.
 *
 * Idempotent per school, so a run that failed halfway through can simply be
 * repeated: the schools already built are returned untouched and only the
 * missing ones are created. Use `resetDemoTenant` to rebuild from scratch.
 */
export async function provisionDemoTenant(createdById: string): Promise<ProvisionResult> {
  const status = await demoStatus();
  const schools: ProvisionedSchool[] = [];

  for (const spec of DEMO_SCHOOLS) {
    const existing = status.schools.find((s) => s.name === spec.name);
    if (existing?.exists && existing.schoolId) {
      schools.push({
        name: spec.name,
        schoolId: existing.schoolId,
        schoolHeadEmail: existing.schoolHeadEmail,
      });
      continue;
    }

    const result = await provisionOne(spec, createdById);
    // Fail loudly on the first problem rather than pressing on: a partial set is
    // confusing to reason about, and the schools already created are kept, so
    // pressing the button again resumes where this stopped.
    if (!result.ok) return result;
    schools.push(result.school);
  }

  return { ok: true, schools, initialPassword: DEMO_SCHOOL_ID_CODE };
}

/**
 * Delete every demo school and everything under them, then rebuild the set.
 *
 * The hard delete is acceptable *only* because the rows were looked up by
 * `isDemo: true` — that flag is the guarantee they hold training data and no
 * real learner PII. The lookup is the safety check; do not relax it into a
 * lookup by name or by an id supplied from a form.
 */
export async function resetDemoTenant(createdById: string): Promise<ProvisionResult> {
  const existing = await prisma.school.findMany({
    where: { isDemo: true },
    select: { id: true },
  });

  if (existing.length > 0) {
    for (const school of existing) {
      const { authIds } = await deleteSchoolCompletely(school.id);

      // Identities have no foreign key into `User`, so they are removed after
      // the rows are gone. A failure here leaves a stale identity, which
      // `provisionDemoTenant` then reuses rather than tripping over — so it is
      // logged, not fatal.
      for (const authId of authIds) {
        try {
          await deleteIdentity(authId);
        } catch (err) {
          console.error("[demo] deleting identity failed:", err instanceof Error ? err.message : err);
        }
      }
    }
  }

  return provisionDemoTenant(createdById);
}
