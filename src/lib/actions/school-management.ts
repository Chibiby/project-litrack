"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser, requireUser } from "@/lib/auth/session";
import {
  updateSchoolInfoSchema,
  setSchoolActiveSchema,
  adminProfileSchema,
} from "@/lib/validators/school.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  revalidateAdminDashboard,
  revalidateSchoolDashboard,
  revalidateSchoolsList,
} from "@/lib/cache/revalidate";

type ActionResult = { ok: true } | { ok: false; error: string };

/** School Head: update school display fields (not schoolIdCode). */
export async function updateSchoolInfo(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = updateSchoolInfoSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address") || undefined,
    region: formData.get("region") || undefined,
    division: formData.get("division") || undefined,
    district: formData.get("district") || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const nameTaken = await prisma.school.findFirst({
    where: {
      name: parsed.data.name,
      deletedAt: null,
      NOT: { id: user.schoolId },
    },
  });
  if (nameTaken) return { ok: false, error: "A school with this name already exists" };

  await prisma.school.update({
    where: { id: user.schoolId },
    data: {
      name: parsed.data.name,
      address: parsed.data.address ?? null,
      region: parsed.data.region ?? null,
      division: parsed.data.division ?? null,
      district: parsed.data.district ?? null,
    },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.SCHOOL_UPDATE,
    resource: "School",
    resourceId: user.schoolId,
    metadata: { schoolId: user.schoolId, name: parsed.data.name },
  });

  revalidatePath("/school-head/school-info");
  revalidatePath("/school-head");
  revalidateSchoolDashboard(user.schoolId);
  revalidateSchoolsList();
  return { ok: true };
}

/** Super Admin: activate or deactivate a school (soft archival via isActive). */
export async function setSchoolActive(formData: FormData): Promise<ActionResult> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = setSchoolActiveSchema.safeParse({
    schoolId: formData.get("schoolId"),
    isActive: formData.get("isActive"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const school = await prisma.school.findFirst({
    where: { id: parsed.data.schoolId, deletedAt: null },
  });
  if (!school) return { ok: false, error: "School not found" };

  await prisma.school.update({
    where: { id: school.id },
    data: { isActive: parsed.data.isActive },
  });

  await writeAudit({
    userId: admin.id,
    schoolId: school.id,
    action: AUDIT_ACTIONS.SCHOOL_SET_ACTIVE,
    resource: "School",
    resourceId: school.id,
    metadata: { schoolId: school.id, isActive: parsed.data.isActive },
  });

  revalidatePath("/admin/schools");
  revalidatePath("/admin");
  revalidateSchoolsList();
  revalidateSchoolDashboard(school.id);
  return { ok: true };
}

/** Super Admin: update display name fields. */
export async function updateAdminProfile(formData: FormData): Promise<ActionResult> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = adminProfileSchema.safeParse({
    firstName: formData.get("firstName"),
    middleName: formData.get("middleName") || undefined,
    lastName: formData.get("lastName"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const middleName = parsed.data.middleName ?? null;
  const fullName = [parsed.data.firstName, middleName, parsed.data.lastName]
    .filter(Boolean)
    .join(" ");

  await prisma.user.update({
    where: { id: admin.id },
    data: {
      firstName: parsed.data.firstName,
      middleName,
      lastName: parsed.data.lastName,
      fullName,
    },
  });

  await writeAudit({
    userId: admin.id,
    schoolId: null,
    action: AUDIT_ACTIONS.ADMIN_PROFILE_UPDATE,
    resource: "User",
    resourceId: admin.id,
    metadata: { userId: admin.id },
  });

  revalidatePath("/admin/profile");
  revalidatePath("/admin");
  revalidateAdminDashboard();
  return { ok: true };
}
