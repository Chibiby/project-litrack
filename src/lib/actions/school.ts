"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { createSchoolSchema } from "@/lib/validators/school.schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { schoolHeadSyntheticEmail } from "@/lib/auth/synthetic-email";
import { generateActivationCredential } from "@/lib/auth/credentials";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolsList } from "@/lib/cache/tags";
import {
  revalidateSchoolDashboard,
  revalidateSchoolsList,
} from "@/lib/cache/revalidate";
import { z } from "zod";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const REGEN_RATE = { limit: 5, windowMs: 15 * 60 * 1000 } as const;

/**
 * Super-admin only: creates a School + School Head auth user with a one-time
 * activation credential (NOT the School ID). Credential returned once; never stored.
 */
export async function createSchool(
  formData: FormData
): Promise<ActionResult<{ id: string; activationCredential: string }>> {
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

  const exists = await prisma.school.findFirst({
    where: { OR: [{ name: parsed.data.name }, { schoolIdCode: parsed.data.schoolIdCode }] },
  });
  if (exists) return { ok: false, error: "School name or School ID already exists" };

  const activationCredential = generateActivationCredential();
  const supabaseAdmin = createSupabaseAdminClient();
  const syntheticEmail = schoolHeadSyntheticEmail(parsed.data.schoolIdCode);

  const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: syntheticEmail,
    password: activationCredential,
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
        firstName: "School",
        lastName: "Head",
        fullName: `${createdSchool.name} Head`,
        isActive: true,
        mustChangePassword: true,
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
  return { ok: true, data: { id: school.id, activationCredential } };
}

/**
 * Super Admin: issue a new one-time School Head activation credential.
 * Returns the credential once; never stores or audits the plaintext.
 */
export async function regenerateSchoolHeadCredential(
  formData: FormData
): Promise<ActionResult<{ activationCredential: string }>> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = z.object({ schoolId: z.string().uuid() }).safeParse({
    schoolId: formData.get("schoolId"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid school" };

  const rate = checkRateLimit(`regen:sh:${parsed.data.schoolId}`, REGEN_RATE);
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
  });
  if (!shUser) return { ok: false, error: "School Head account not found" };

  const activationCredential = generateActivationCredential();
  const supabaseAdmin = createSupabaseAdminClient();
  const { error } = await supabaseAdmin.auth.admin.updateUserById(shUser.authId, {
    password: activationCredential,
    app_metadata: { role: "SCHOOL_HEAD", schoolId: school.id },
  });
  if (error) return { ok: false, error: "Failed to regenerate credential" };

  await prisma.user.update({
    where: { id: shUser.id },
    data: { mustChangePassword: true, isActive: true },
  });

  await writeAudit({
    userId: admin.id,
    schoolId: school.id,
    action: AUDIT_ACTIONS.SCHOOL_HEAD_CREDENTIAL_REGENERATED,
    resource: "User",
    resourceId: shUser.id,
    metadata: { schoolId: school.id },
  });

  revalidatePath("/admin/schools");
  revalidateSchoolsList();
  return { ok: true, data: { activationCredential } };
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
 */
export async function listSchoolsWithTeacherStatus() {
  return cachedQuery(
    async () => {
      const schools = await prisma.school.findMany({
        where: { isActive: true, deletedAt: null },
        select: {
          id: true,
          name: true,
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
        teachersOpen: s.users.length > 0 && s._count.gradeLevels > 0,
      }));
    },
    {
      keyParts: ["schools-with-teacher-status"],
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
