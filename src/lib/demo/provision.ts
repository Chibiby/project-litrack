import "server-only";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { schoolHeadSyntheticEmail } from "@/lib/auth/synthetic-email";
import {
  DEMO_EMAIL_CODE,
  DEMO_ADDRESS,
  DEMO_DISTRICT_NAME,
  DEMO_DIVISION,
  DEMO_REGION,
  DEMO_SCHOOL_ID_CODE,
  DEMO_SCHOOL_NAME,
} from "@/lib/demo/constants";
import { deleteSchoolCompletely } from "@/lib/demo/teardown";

export type DemoStatus = {
  exists: boolean;
  schoolId: string | null;
  /** Present only once the school row exists; the login credential to read on camera. */
  schoolIdCode: string;
  districtName: string;
  schoolName: string;
  /** The School Head's synthetic login email, for the Super Admin's reference. */
  schoolHeadEmail: string | null;
  createdAt: Date | null;
};

/**
 * The demo school is identified by `isDemo`, never by its name.
 *
 * Name matching would be fragile in exactly the way that matters here: a School
 * Head can rename their own school from the school profile form, and the demo
 * School Head is a real account that will be driven live during the recording.
 * A renamed demo school must still be recognisable as demo data.
 */
export async function findDemoSchool() {
  return prisma.school.findFirst({
    where: { isDemo: true, deletedAt: null },
    select: { id: true, name: true, schoolIdCode: true, createdAt: true },
  });
}

export async function demoStatus(): Promise<DemoStatus> {
  const school = await findDemoSchool();
  return {
    exists: Boolean(school),
    schoolId: school?.id ?? null,
    schoolIdCode: school?.schoolIdCode ?? DEMO_SCHOOL_ID_CODE,
    districtName: DEMO_DISTRICT_NAME,
    schoolName: DEMO_SCHOOL_NAME,
    schoolHeadEmail: school ? schoolHeadSyntheticEmail(DEMO_EMAIL_CODE) : null,
    createdAt: school?.createdAt ?? null,
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

export type ProvisionResult =
  | { ok: true; schoolId: string; initialPassword: string; schoolHeadEmail: string }
  | { ok: false; error: string };

/**
 * Create the demo district + school + School Head, exactly as the training video
 * describes them.
 *
 * The School Head's first-login password is the School ID, and
 * `mustChangePassword` is true — identical to `createSchool`, because the video
 * teaches that flow and a demo that skipped the change-password prompt would be
 * teaching a screen that does not exist for real schools.
 *
 * Idempotent: if a demo school already exists this returns it untouched rather
 * than creating a second one. Use `resetDemoTenant` to rebuild.
 */
export async function provisionDemoTenant(createdById: string): Promise<ProvisionResult> {
  const existing = await findDemoSchool();
  if (existing) {
    return {
      ok: true,
      schoolId: existing.id,
      initialPassword: existing.schoolIdCode,
      schoolHeadEmail: schoolHeadSyntheticEmail(DEMO_EMAIL_CODE),
    };
  }

  // A real school sharing the School ID is fine and expected — the unique index
  // on `schoolIdCode` is partial (`WHERE "isDemo" = false`), so the demo is
  // exempt. `name` is still globally unique, and that one cannot be worked
  // around here: the real school owns the name and renaming it is the admin's
  // call, not this function's.
  const nameClash = await prisma.school.findFirst({
    where: { name: DEMO_SCHOOL_NAME },
    select: { id: true, name: true },
  });
  if (nameClash) {
    return {
      ok: false,
      error: `Another school is already named "${DEMO_SCHOOL_NAME}". Rename it first.`,
    };
  }

  // Derived from DEMO_EMAIL_CODE, not the School ID: the ID may be shared with a
  // real school, and a login address may not be. See DEMO_EMAIL_CODE.
  const syntheticEmail = schoolHeadSyntheticEmail(DEMO_EMAIL_CODE);
  const supabaseAdmin = createSupabaseAdminClient();

  // A previous demo tenant that was reset leaves no auth user behind, but a
  // half-failed create can. Reuse it rather than failing on "email exists".
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
        name: DEMO_SCHOOL_NAME,
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
    schoolId: school.id,
    initialPassword: DEMO_SCHOOL_ID_CODE,
    schoolHeadEmail: syntheticEmail,
  };
}

/**
 * Delete the demo tenant and every row under it, then rebuild it fresh.
 *
 * The hard delete is acceptable *only* because the row was looked up by
 * `isDemo: true` — that flag is the guarantee that the target holds training
 * data and no real learner PII. The lookup is the safety check; do not relax it
 * into a lookup by name or by id supplied from a form.
 */
export async function resetDemoTenant(createdById: string): Promise<ProvisionResult> {
  const school = await prisma.school.findFirst({
    where: { isDemo: true },
    select: { id: true },
  });

  if (school) {
    const { authIds } = await deleteSchoolCompletely(school.id);

    // Supabase auth users have no foreign key into Prisma, so they are removed
    // one at a time after the rows are gone. A failure here leaves a stale auth
    // user, which `provisionDemoTenant` below then reuses rather than tripping
    // over — so it is logged, not fatal.
    const supabaseAdmin = createSupabaseAdminClient();
    for (const authId of authIds) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(authId);
      if (error) console.error("[demo] deleting auth user failed:", error.message);
    }
  }

  return provisionDemoTenant(createdById);
}
