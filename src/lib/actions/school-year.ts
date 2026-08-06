"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import {
  createSchoolYearSchema,
  setActiveSchoolYearSchema,
} from "@/lib/validators/school-year.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function createSchoolYear(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = createSchoolYearSchema.safeParse({
    label: formData.get("label"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
    setActive: formData.get("setActive") ?? false,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const startDate = new Date(parsed.data.startDate);
  const endDate = new Date(parsed.data.endDate);

  try {
    const year = await prisma.$transaction(async (tx) => {
      if (parsed.data.setActive) {
        await tx.schoolYear.updateMany({
          where: { schoolId: user.schoolId, isActive: true },
          data: { isActive: false },
        });
      }

      return tx.schoolYear.create({
        data: {
          schoolId: user.schoolId,
          label: parsed.data.label,
          startDate,
          endDate,
          isActive: parsed.data.setActive,
        },
      });
    });

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.SCHOOL_YEAR_CREATE,
      resource: "SchoolYear",
      resourceId: year.id,
      metadata: {
        schoolId: user.schoolId,
        label: year.label,
        isActive: year.isActive,
      },
    });

    revalidatePath("/school-head/school-years");
    revalidatePath("/school-head");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("Unique constraint") || msg.includes("schoolId_label")) {
      return { ok: false, error: "A school year with this label already exists" };
    }
    console.error("[createSchoolYear]", err);
    return { ok: false, error: "Failed to create school year" };
  }
}

export async function setActiveSchoolYear(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = setActiveSchoolYearSchema.safeParse({
    schoolYearId: formData.get("schoolYearId"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const year = await prisma.schoolYear.findFirst({
    where: { id: parsed.data.schoolYearId, schoolId: user.schoolId },
  });
  if (!year) return { ok: false, error: "School year not found" };

  await prisma.$transaction(async (tx) => {
    await tx.schoolYear.updateMany({
      where: { schoolId: user.schoolId, isActive: true },
      data: { isActive: false },
    });
    await tx.schoolYear.update({
      where: { id: year.id },
      data: { isActive: true },
    });
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.SCHOOL_YEAR_SET_ACTIVE,
    resource: "SchoolYear",
    resourceId: year.id,
    metadata: { schoolId: user.schoolId, label: year.label },
  });

  revalidatePath("/school-head/school-years");
  revalidatePath("/school-head");
  return { ok: true };
}
