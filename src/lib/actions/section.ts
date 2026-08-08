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
import { revalidateSchoolDashboard } from "@/lib/cache/revalidate";
import { nextUnusedLetter } from "@/lib/section-letters";

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
    revalidateSchoolDashboard(user.schoolId);
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
    revalidatePath("/school-head/grade-levels");
    revalidateSchoolDashboard(user.schoolId);
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

  try {
    await prisma.$transaction(async (tx) => {
      await tx.section.update({
        where: { id: section.id },
        data: { deletedAt: new Date() },
      });

      await tx.learner.updateMany({
        where: { sectionId: section.id },
        data: { sectionId: null },
      });

      await tx.enrollment.updateMany({
        where: { sectionId: section.id },
        data: { sectionId: null },
      });

      // Drop teacher↔section links, then disconnect taughtGrades when a teacher
      // has no remaining active sections in this grade.
      const assigned = await tx.teacherSection.findMany({
        where: { sectionId: section.id },
        select: { teacherId: true },
      });
      await tx.teacherSection.deleteMany({ where: { sectionId: section.id } });

      const teacherIds = [...new Set(assigned.map((a) => a.teacherId))];
      for (const teacherId of teacherIds) {
        const remainingInGrade = await tx.teacherSection.count({
          where: {
            teacherId,
            section: {
              gradeLevelId: section.gradeLevelId,
              deletedAt: null,
            },
          },
        });
        if (remainingInGrade === 0) {
          await tx.user.update({
            where: { id: teacherId },
            data: {
              taughtGrades: { disconnect: { id: section.gradeLevelId } },
            },
          });
        }
      }
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
    revalidatePath("/school-head/grade-levels");
    revalidatePath("/school-head/teachers");
    revalidateSchoolDashboard(user.schoolId);
    return { ok: true };
  } catch (err) {
    console.error("[deleteSection]", err);
    return { ok: false, error: "Failed to delete section" };
  }
}

export async function createNextLetterSection(formData: FormData): Promise<ActionResult> {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const gradeLevelId = String(formData.get("gradeLevelId") ?? "").trim();
  if (!gradeLevelId) return { ok: false, error: "Grade level required" };

  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: gradeLevelId,
      schoolId: user.schoolId,
      deletedAt: null,
    },
  });
  if (!grade) return { ok: false, error: "Grade level not found" };

  const active = await prisma.section.findMany({
    where: { gradeLevelId, schoolId: user.schoolId, deletedAt: null },
    select: { name: true },
  });

  const letter = nextUnusedLetter(active.map((s) => s.name));
  if (!letter) return { ok: false, error: "All letters A–Z are already used" };

  const fd = new FormData();
  fd.set("gradeLevelId", gradeLevelId);
  fd.set("name", letter);
  return createSection(fd);
}
