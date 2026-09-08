import "server-only";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
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

/**
 * Find the Supabase auth user behind an email, or null.
 *
 * `listUsers` is paged rather than searchable in supabase-js v2, so this walks
 * pages. The demo tenant is provisioned once and reset rarely, so the cost is
 * irrelevant next to the correctness of not orphaning an auth user.
 */
async function findAuthUserByEmail(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  email: string
): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
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
  createdById: string,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
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

  // A reset leaves no auth user behind, but a half-failed create can. Reuse it
  // rather than failing on "email already registered".
  let authId = await findAuthUserByEmail(supabaseAdmin, syntheticEmail);
  if (authId) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(authId, {
      password: DEMO_SCHOOL_ID_CODE,
      app_metadata: { role: "SCHOOL_HEAD" },
    });
    if (error) return { ok: false, error: error.message };
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: syntheticEmail,
      password: DEMO_SCHOOL_ID_CODE,
      email_confirm: true,
      app_metadata: { role: "SCHOOL_HEAD" },
      user_metadata: { role: "SCHOOL_HEAD" },
    });
    if (error || !data.user) {
      return { ok: false, error: error?.message ?? "Auth bootstrap failed" };
    }
    authId = data.user.id;
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
      where: { authId: authId! },
      create: {
        authId: authId!,
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

  await supabaseAdmin.auth.admin.updateUserById(authId, {
    app_metadata: { role: "SCHOOL_HEAD", schoolId: school.id },
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
  const supabaseAdmin = createSupabaseAdminClient();
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

    const result = await provisionOne(spec, createdById, supabaseAdmin);
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
    const supabaseAdmin = createSupabaseAdminClient();
    for (const school of existing) {
      const { authIds } = await deleteSchoolCompletely(school.id);

      // Supabase auth users have no foreign key into Prisma, so they are removed
      // after the rows are gone. A failure here leaves a stale auth user, which
      // `provisionDemoTenant` then reuses rather than tripping over — so it is
      // logged, not fatal.
      for (const authId of authIds) {
        const { error } = await supabaseAdmin.auth.admin.deleteUser(authId);
        if (error) console.error("[demo] deleting auth user failed:", error.message);
      }
    }
  }

  return provisionDemoTenant(createdById);
}
