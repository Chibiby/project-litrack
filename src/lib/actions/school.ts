"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { createSchoolSchema } from "@/lib/validators/school.schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { schoolHeadSyntheticEmail } from "@/lib/auth/synthetic-email";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Super-admin only: creates a School + bootstraps the School Head Supabase auth
 * user (synthetic email, password = schoolIdCode). The actual School Head User
 * row is created lazily on first profile completion.
 */
export async function createSchool(formData: FormData): Promise<ActionResult<{ id: string }>> {
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

  const supabaseAdmin = createSupabaseAdminClient();
  const syntheticEmail = schoolHeadSyntheticEmail(parsed.data.schoolIdCode);

  // Create the SH Supabase auth user; password = schoolIdCode
  const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: syntheticEmail,
    password: parsed.data.schoolIdCode,
    email_confirm: true,
    user_metadata: { role: "SCHOOL_HEAD" },
  });
  if (authErr || !created.user) return { ok: false, error: authErr?.message ?? "Auth bootstrap failed" };

  const school = await prisma.school.create({
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

  // Pre-create the SH User row (fullName placeholder; profile completes it)
  await prisma.user.create({
    data: {
      authId: created.user.id,
      email: syntheticEmail,
      role: "SCHOOL_HEAD",
      schoolId: school.id,
      firstName: "School",
      lastName: "Head",
      fullName: `${school.name} Head`,
      isActive: true,
      profileCompleted: false,
    },
  });

  revalidatePath("/admin/schools");
  return { ok: true, data: { id: school.id } };
}

export async function listSchoolsPublic() {
  return prisma.school.findMany({
    where: { isActive: true, deletedAt: null },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function listSchoolsWithTeacherStatus() {
  const schools = await prisma.school.findMany({
    where: { isActive: true, deletedAt: null },
    select: {
      id: true,
      name: true,
      _count: {
        select: {
          users: {
            where: { role: "TEACHER", deletedAt: null, isActive: true },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });
  return schools.map((s) => ({
    id: s.id,
    name: s.name,
    hasTeachers: s._count.users > 0,
  }));
}

export async function deleteSchool(formData: FormData): Promise<void> {
  await requireUser("SUPER_ADMIN");
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Missing id");
  await prisma.school.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });
  revalidatePath("/admin/schools");
}
