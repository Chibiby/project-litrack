"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireSchoolUser } from "@/lib/auth/session";
import {
  createSectionSchema,
  updateSectionSchema,
  sectionIdSchema,
} from "@/lib/validators/section.schema";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";

type ActionResult = { ok: true } | { ok: false; error: string };

export async function createSection(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = createSectionSchema.safeParse({
    gradeLevelId: formData.get("gradeLevelId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: parsed.data.gradeLevelId,
      schoolId: user.schoolId,
      deletedAt: null,
    },
  });
  if (!grade) return { ok: false, error: "Grade level not found" };

  try {
    const existing = await prisma.section.findFirst({
      where: {
        gradeLevelId: parsed.data.gradeLevelId,
        name: parsed.data.name,
      },
    });

    let section;
    if (existing?.deletedAt) {
      section = await prisma.section.update({
        where: { id: existing.id },
        data: { deletedAt: null },
      });
    } else if (existing) {
      return { ok: false, error: "A section with this name already exists in this grade" };
    } else {
      section = await prisma.section.create({
        data: {
          schoolId: user.schoolId,
          gradeLevelId: parsed.data.gradeLevelId,
          name: parsed.data.name,
        },
      });
    }

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.SECTION_CREATE,
      resource: "Section",
      resourceId: section.id,
      metadata: {
        schoolId: user.schoolId,
        gradeLevelId: section.gradeLevelId,
        name: section.name,
      },
    });

    revalidatePath("/school-head/sections");
    revalidatePath("/school-head/grade-levels");
    return { ok: true };
  } catch (err) {
    console.error("[createSection]", err);
    return { ok: false, error: "Failed to create section" };
  }
}

export async function updateSection(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = updateSectionSchema.safeParse({
    sectionId: formData.get("sectionId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const section = await prisma.section.findFirst({
    where: {
      id: parsed.data.sectionId,
      schoolId: user.schoolId,
      deletedAt: null,
    },
  });
  if (!section) return { ok: false, error: "Section not found" };

  try {
    await prisma.section.update({
      where: { id: section.id },
      data: { name: parsed.data.name },
    });

    await writeAudit({
      userId: user.id,
      schoolId: user.schoolId,
      action: AUDIT_ACTIONS.SECTION_UPDATE,
      resource: "Section",
      resourceId: section.id,
      metadata: {
        schoolId: user.schoolId,
        sectionId: section.id,
        name: parsed.data.name,
      },
    });

    revalidatePath("/school-head/sections");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("Unique constraint") || msg.includes("gradeLevelId_name")) {
      return { ok: false, error: "A section with this name already exists in this grade" };
    }
    console.error("[updateSection]", err);
    return { ok: false, error: "Failed to update section" };
  }
}

export async function deleteSection(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = sectionIdSchema.safeParse({
    sectionId: formData.get("sectionId"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }

  const section = await prisma.section.findFirst({
    where: {
      id: parsed.data.sectionId,
      schoolId: user.schoolId,
      deletedAt: null,
    },
  });
  if (!section) return { ok: false, error: "Section not found" };

  await prisma.section.update({
    where: { id: section.id },
    data: { deletedAt: new Date() },
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.SECTION_DELETE,
    resource: "Section",
    resourceId: section.id,
    metadata: { schoolId: user.schoolId, sectionId: section.id, name: section.name },
  });

  revalidatePath("/school-head/sections");
  return { ok: true };
}
