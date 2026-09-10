"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { createSchoolSchema } from "@/lib/validators/school.schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { schoolHeadSyntheticEmail } from "@/lib/auth/synthetic-email";
import { defaultSchoolHeadPassword } from "@/lib/auth/school-head-password";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { cachedQuery } from "@/lib/cache/unstable";
import { demoSchoolFilter, isDemoEnabled } from "@/lib/settings/system-settings";
import { schoolsList } from "@/lib/cache/tags";
import {
  revalidateSchoolDashboard,
  revalidateSchoolsList,
} from "@/lib/cache/revalidate";
import { z } from "zod";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const REGEN_RATE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;

/**
 * Super-admin only: creates a School + School Head auth user whose initial password
 * IS the School ID. Returned once for the admin to relay; never stored in Prisma.
 */
export async function createSchool(
  formData: FormData
): Promise<ActionResult<{ id: string; initialPassword: string }>> {
  const admin = await requireUser("SUPER_ADMIN");

  const f = (k: string) => {
    const v = formData.get(k);
    return v === null ? undefined : v;
  };
  const parsed = createSchoolSchema.safeParse({
    name: f("name"),
    schoolIdCode: f("schoolIdCode"),
    address: f("address"),
    region: f("region"),
    division: f("division"),
    district: f("district"),
    schoolHeadEmail: f("schoolHeadEmail"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };

  // Name is globally unique, so it is checked against every school. The School
  // ID is only unique among real ones — the demo tenant is exempt by a partial
  // index — so checking it globally would let the demo school block an admin
  // from creating the real school that legitimately owns that ID.
  // Both probes are case-insensitive. Exact matching let "Sample Central ES" and
  // "SAMPLE CENTRAL ES" coexist, and — worse — let School IDs 123ABC and 123abc
  // both exist, which matters because the ID doubles as the Head's first password.
  // The stored casing is still whatever the admin typed; only the check is folded.
  const [nameTaken, codeTaken] = await Promise.all([
    prisma.school.findFirst({
      where: { name: { equals: parsed.data.name, mode: "insensitive" } },
      select: { id: true },
    }),
    prisma.school.findFirst({
      where: {
        schoolIdCode: { equals: parsed.data.schoolIdCode, mode: "insensitive" },
        isDemo: false,
      },
      select: { id: true },
    }),
  ]);
  if (nameTaken || codeTaken) {
    return { ok: false, error: "School name or School ID already exists" };
  }

  // The School ID is the single, universal first-time credential — the same rule the
  // roster import follows. `mustChangePassword: true` below forces replacement at first login.
  // An extension entered as `130554-3` starts on the bare `130554`, like its mother school;
  // the email below stays on the stored code, which is what keeps it unique.
  const initialPassword = defaultSchoolHeadPassword(parsed.data.schoolIdCode);
  const supabaseAdmin = createSupabaseAdminClient();
  const syntheticEmail = schoolHeadSyntheticEmail(parsed.data.schoolIdCode);

  const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: syntheticEmail,
    password: initialPassword,
    email_confirm: true,
    app_metadata: { role: "SCHOOL_HEAD" },
    user_metadata: { role: "SCHOOL_HEAD" },
  });
  if (authErr || !created.user) return { ok: false, error: authErr?.message ?? "Auth bootstrap failed" };

  const school = await prisma.$transaction(async (tx) => {
    const createdSchool = await tx.school.create({
      data: {
        name: parsed.data.name,
        schoolIdCode: parsed.data.schoolIdCode,
        address: parsed.data.address,
        region: parsed.data.region,
        division: parsed.data.division,
        district: parsed.data.district,
        createdById: admin.id,
      },
    });

    await tx.user.create({
      data: {
        authId: created.user!.id,
        email: syntheticEmail,
        role: "SCHOOL_HEAD",
        schoolId: createdSchool.id,
        firstName: "",
        lastName: "",
        fullName: createdSchool.name,
        isActive: true,
        mustChangePassword: true,
        // The password set just above IS the School ID. Recording that is what
        // lets the Super Admin console show a working credential later without
        // anyone storing a plaintext password.
        passwordIsSchoolId: true,
        profileCompleted: false,
      },
    });

    return createdSchool;
  });

  await supabaseAdmin.auth.admin.updateUserById(created.user.id, {
    app_metadata: { role: "SCHOOL_HEAD", schoolId: school.id },
  });

  await writeAudit({
    userId: admin.id,
    schoolId: school.id,
    action: AUDIT_ACTIONS.SCHOOL_CREATE,
    resource: "School",
    resourceId: school.id,
    metadata: { schoolId: school.id, name: school.name },
  });

  revalidatePath("/admin/schools");
  revalidateSchoolsList();
  return { ok: true, data: { id: school.id, initialPassword } };
}

/**
 * Super Admin: put a School Head's password back to the school's School ID.
 *
 * This used to issue a random one-time credential, shown to the admin once. It
 * reached the school — if at all — by being read out, and heads went on typing
 * the School ID they already knew into an account that no longer accepted it:
 * Salimama IS logged over a hundred failed sign-ins after one regeneration on
 * 2026-09-10. The School ID is the credential every head is told to use, the one
 * `createSchool` and the roster import issue, and the one
 * `resetSchoolHeadPasswordToDefault` restores — so this now does the same.
 *
 * The School ID is printed on the schools table, so returning it reveals nothing.
 */
export async function regenerateSchoolHeadCredential(
  formData: FormData
): Promise<ActionResult<{ password: string }>> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = z.object({ schoolId: z.string().uuid() }).safeParse({
    schoolId: formData.get("schoolId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid school" };

  const rate = await checkRateLimit(`regen:sh:${parsed.data.schoolId}`, REGEN_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await prisma.school.findFirst({
    where: { id: parsed.data.schoolId, deletedAt: null },
    select: { id: true, schoolIdCode: true },
  });
  if (!school) return { ok: false, error: "School not found" };

  const shUser = await prisma.user.findFirst({
    where: {
      schoolId: school.id,
      role: "SCHOOL_HEAD",
      deletedAt: null,
    },
    select: { id: true, authId: true },
    // Must pick the same row the sign-in does (`findSchoolHead` in ./login and
    // `loginSchoolHead` in ./auth). Unordered, a school with two head rows could
    // have its password reset on an account nobody signs in to.
    orderBy: { createdAt: "asc" },
  });
  if (!shUser) return { ok: false, error: "School Head account not found" };

  const password = defaultSchoolHeadPassword(school.schoolIdCode);
  const supabaseAdmin = createSupabaseAdminClient();
  const { error } = await supabaseAdmin.auth.admin.updateUserById(shUser.authId, {
    password,
    app_metadata: { role: "SCHOOL_HEAD", schoolId: school.id },
  });
  if (error) return { ok: false, error: "Failed to reset password" };

  await prisma.user.update({
    where: { id: shUser.id },
    // Same post-state as `resetSchoolHeadPasswordToDefault`: the School ID works
    // on the very next sign-in, with no forced interstitial, and the console can
    // show it because the live password is once again the School ID.
    data: { mustChangePassword: false, isActive: true, passwordIsSchoolId: true },
  });

  // Recorded as a reset-to-default, not a regeneration: the audit trail is how
  // `passwordIsSchoolId` is replayed (see the 20260910000004 backfill), and a
  // REGENERATED row would say the School ID stopped working when it just started.
  await writeAudit({
    userId: admin.id,
    schoolId: school.id,
    action: AUDIT_ACTIONS.SCHOOL_HEAD_PASSWORD_RESET_DEFAULT,
    resource: "User",
    resourceId: shUser.id,
    metadata: { schoolId: school.id, via: "schools_table" },
  });

  revalidatePath("/admin/schools");
  revalidatePath("/admin/school-accounts");
  revalidateSchoolsList();
  return { ok: true, data: { password } };
}

/** Active schools (id + name). Cached ~60s under `schools-list`. */
export async function listSchoolsPublic() {
  return cachedQuery(
    () =>
      prisma.school.findMany({
        where: { isActive: true, deletedAt: null },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    {
      keyParts: ["schools-public"],
      tags: [schoolsList],
      revalidate: 60,
    }
  );
}

/**
 * Teachers unlock when an active, profiled School Head exists and
 * the school has at least one grade level (teachers self-register).
 * Cached ~60s under `schools-list`; bust via `revalidateSchoolsList()`.
 *
 * The demo tenant is filtered out unless demo mode is on. This is the query
 * behind the login page's District and School dropdowns, so it is the surface
 * the switch most visibly controls — and the one where a stray "[demo school]"
 * in front of real teachers would do the most damage. `setDemoMode` busts the
 * `schools-list` tag, so the switch takes effect on the next load rather than
 * after the 60-second TTL.
 */
export async function listSchoolsWithTeacherStatus() {
  const demoEnabled = await isDemoEnabled();
  return cachedQuery(
    async () => {
      const schools = await prisma.school.findMany({
        where: { isActive: true, deletedAt: null, ...demoSchoolFilter(demoEnabled) },
        select: {
          id: true,
          name: true,
          district: true,
          _count: {
            select: {
              gradeLevels: { where: { deletedAt: null } },
            },
          },
          users: {
            where: {
              role: "SCHOOL_HEAD",
              deletedAt: null,
              isActive: true,
              profileCompleted: true,
            },
            select: { id: true },
            take: 1,
          },
        },
        orderBy: { name: "asc" },
      });
      return schools.map((s) => ({
        id: s.id,
        name: s.name,
        district: s.district,
        teachersOpen: s.users.length > 0 && s._count.gradeLevels > 0,
      }));
    },
    {
      // `demo` is part of the key, not just of the closure: two different
      // school lists exist and an `unstable_cache` entry keyed without it would
      // serve the wrong one for up to the TTL after the switch is flipped.
      keyParts: ["schools-with-teacher-status", `demo:${demoEnabled}`],
      tags: [schoolsList],
      revalidate: 60,
    }
  );
}

export async function deleteSchool(formData: FormData): Promise<void> {
  const admin = await requireUser("SUPER_ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id");
  await prisma.school.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  await writeAudit({
    userId: admin.id,
    schoolId: id,
    action: AUDIT_ACTIONS.SCHOOL_DELETE,
    resource: "School",
    resourceId: id,
    metadata: { schoolId: id },
  });
  revalidatePath("/admin/schools");
  revalidateSchoolsList();
  revalidateSchoolDashboard(id);
}
