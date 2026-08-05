"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { isPrismaConnectionError } from "@/lib/auth/app-user";
import { createSchoolSchema } from "@/lib/validators/school.schema";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServiceEnv } from "@/lib/supabase/env";
import { schoolHeadSyntheticEmail } from "@/lib/auth/synthetic-email";

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/**
 * Super-admin only: creates a School + bootstraps the School Head Supabase auth
 * user (synthetic email, password = schoolIdCode). The School Head User row is
 * created in the same transaction as the school.
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

  const { data: created, error: authErr } = await supabaseAdmin.auth.admin.createUser({
    email: syntheticEmail,
    password: parsed.data.schoolIdCode,
    email_confirm: true,
    app_metadata: { role: "SCHOOL_HEAD" },
  });
  if (authErr || !created.user) {
    console.error("[createSchool] auth createUser failed:", authErr);
    return { ok: false, error: "Failed to create school. Please try again." };
  }

  const authUserId = created.user.id;

  try {
    const school = await prisma.$transaction(async (tx) => {
      const s = await tx.school.create({
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
          authId: authUserId,
          email: syntheticEmail,
          role: "SCHOOL_HEAD",
          schoolId: s.id,
          firstName: "School",
          lastName: "Head",
          fullName: `${s.name} Head`,
          isActive: true,
          profileCompleted: false,
        },
      });
      return s;
    });

    revalidatePath("/admin/schools");
    revalidatePath("/login");
    return { ok: true, data: { id: school.id } };
  } catch (err) {
    console.error("[createSchool] prisma failed; deleting auth user:", err);
    try {
      await supabaseAdmin.auth.admin.deleteUser(authUserId);
    } catch (cleanupErr) {
      console.error("[createSchool] auth cleanup failed:", cleanupErr);
    }
    return { ok: false, error: "Failed to create school. Please try again." };
  }
}

type PublicSchoolRow = { id: string; name: string };
type SchoolWithTeacherStatus = PublicSchoolRow & { hasTeachers: boolean };

async function listActiveSchoolsViaPostgrest(): Promise<PublicSchoolRow[] | null> {
  if (!getSupabaseServiceEnv().ok) return null;
  try {
    const admin = createSupabaseAdminClient();
    const { data, error } = await admin
      .from("School")
      .select("id, name")
      .eq("isActive", true)
      .is("deletedAt", null)
      .order("name", { ascending: true });

    if (error || !data) return null;
    return data.map((s) => ({
      id: s.id as string,
      name: s.name as string,
    }));
  } catch {
    return null;
  }
}

async function listSchoolsWithTeacherStatusViaPostgrest(): Promise<
  SchoolWithTeacherStatus[] | null
> {
  if (!getSupabaseServiceEnv().ok) return null;
  try {
    const admin = createSupabaseAdminClient();
    const [{ data: schools, error: schoolsErr }, { data: teachers, error: teachersErr }] =
      await Promise.all([
        admin
          .from("School")
          .select("id, name")
          .eq("isActive", true)
          .is("deletedAt", null)
          .order("name", { ascending: true }),
        admin
          .from("User")
          .select("schoolId")
          .eq("role", "TEACHER")
          .eq("isActive", true)
          .is("deletedAt", null)
          .not("schoolId", "is", null),
      ]);

    // Schools must succeed; teacher status may degrade to false (matches admin count resilience).
    if (schoolsErr || !schools) return null;

    const schoolsWithTeachers = new Set<string>();
    if (!teachersErr) {
      for (const row of teachers ?? []) {
        schoolsWithTeachers.add(row.schoolId as string);
      }
    }

    return schools.map((s) => ({
      id: s.id as string,
      name: s.name as string,
      hasTeachers: schoolsWithTeachers.has(s.id as string),
    }));
  } catch {
    return null;
  }
}

export async function listSchoolsPublic(): Promise<PublicSchoolRow[]> {
  try {
    return await prisma.school.findMany({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  } catch (err) {
    if (!isPrismaConnectionError(err)) throw err;
  }

  return (await listActiveSchoolsViaPostgrest()) ?? [];
}

export async function listSchoolsWithTeacherStatus(): Promise<{
  schools: SchoolWithTeacherStatus[];
  dbAvailable: boolean;
}> {
  try {
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
    return {
      schools: schools.map((s) => ({
        id: s.id,
        name: s.name,
        hasTeachers: s._count.users > 0,
      })),
      dbAvailable: true,
    };
  } catch (err) {
    if (!isPrismaConnectionError(err)) throw err;
  }

  const viaRest = await listSchoolsWithTeacherStatusViaPostgrest();
  if (viaRest) return { schools: viaRest, dbAvailable: true };
  return { schools: [], dbAvailable: false };
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
  revalidatePath("/login");
}
