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
import {
  revalidateSchoolDashboard,
  revalidateSchoolHeadTeachers,
  revalidateSchoolTeachers,
  revalidateTeacherCaches,
} from "@/lib/cache/revalidate";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { nextUnusedLetter } from "@/lib/section-letters";
import { action } from "@/lib/errors/action";
import { fieldError, resourceNotFound } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";

type ActionResult = { ok: true } | { ok: false; error: string };

const SECTION_NAME_TAKEN = "A section with this name already exists in this grade";

export const createSection = action("createSection", async (formData: FormData): Promise<ActionResult> => {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = {
    data: parseInput(createSectionSchema, {
      gradeLevelId: formData.get("gradeLevelId"),
      name: formData.get("name"),
    }),
  };

  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: parsed.data.gradeLevelId,
      schoolId: user.schoolId,
      deletedAt: null,
    },
  });
  if (!grade) throw resourceNotFound("Grade level");

  // Case-insensitive: "Mabini", "MABINI" and "mabini" are one section, not three.
  // The revive path in school-head.ts already folded case; this one did not, and
  // CSV import resolves section names case-insensitively — so duplicates created
  // here silently captured whichever row the importer happened to hit first.
  const existing = await prisma.section.findFirst({
    where: {
      gradeLevelId: parsed.data.gradeLevelId,
      name: { equals: parsed.data.name, mode: "insensitive" },
    },
  });

  let section;
  if (existing?.deletedAt) {
    section = await prisma.section.update({
      where: { id: existing.id },
      data: { deletedAt: null },
    });
  } else if (existing) {
    throw fieldError("name", SECTION_NAME_TAKEN);
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

  revalidatePath(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
  revalidateSchoolDashboard(user.schoolId);
  return { ok: true };
}, { verb: "create the section" });

export const updateSection = action("updateSection", async (formData: FormData): Promise<ActionResult> => {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = {
    data: parseInput(updateSectionSchema, {
      sectionId: formData.get("sectionId"),
      name: formData.get("name"),
    }),
  };

  const section = await prisma.section.findFirst({
    where: {
      id: parsed.data.sectionId,
      schoolId: user.schoolId,
      deletedAt: null,
    },
  });
  if (!section) throw resourceNotFound("Section");

  // Rename had no uniqueness check at all, so "A" could be renamed onto an existing
  // "B" in the same grade. Same case-insensitive rule as create; the section's own
  // row is excluded so re-saving an unchanged name is not reported as a clash.
  const clash = await prisma.section.findFirst({
    where: {
      gradeLevelId: section.gradeLevelId,
      deletedAt: null,
      id: { not: section.id },
      name: { equals: parsed.data.name, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (clash) throw fieldError("name", SECTION_NAME_TAKEN);

  try {
    await prisma.section.update({
      where: { id: section.id },
      data: { name: parsed.data.name },
    });
  } catch (err) {
    // A concurrent rename onto the same name slips past the read above and lands
    // on the unique index. That one known condition keeps its specific message;
    // everything else is classified by `action()`.
    const msg = err instanceof Error ? err.message : "";
    if (
      (err as { code?: unknown } | null)?.code === "P2002" ||
      msg.includes("Unique constraint") ||
      msg.includes("gradeLevelId_name")
    ) {
      throw fieldError("name", SECTION_NAME_TAKEN);
    }
    throw err;
  }

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

  revalidatePath(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
  revalidateSchoolDashboard(user.schoolId);
  // `listAralTutors` builds each teacher's `advisoryLabel` from
  // `advisorySection.name`, so a rename changes that cached list without
  // touching a single `User` row. Nothing else here busts `schoolTeachers`,
  // and every ARAL tutor picker would keep the old section name for the
  // entry's remaining TTL.
  revalidateSchoolTeachers(user.schoolId);
  return { ok: true };
}, { verb: "rename the section" });

export const deleteSection = action("deleteSection", async (formData: FormData): Promise<ActionResult> => {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const parsed = {
    data: parseInput(sectionIdSchema, {
      sectionId: formData.get("sectionId"),
    }),
  };

  const section = await prisma.section.findFirst({
    where: {
      id: parsed.data.sectionId,
      schoolId: user.schoolId,
      deletedAt: null,
    },
  });
  if (!section) throw resourceNotFound("Section");

  const affectedTeacherIds = await prisma.$transaction(async (tx) => {
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

    // Advisory pointer must not survive its section: the section is only
    // soft-deleted, so the FK stays valid and the teacher would otherwise keep
    // an advisory slot on a section nobody can see.
    // Read the advisers first — once the pointer is null there is no way back
    // to who they were, and their caches have to be busted below.
    const advisers = await tx.user.findMany({
      where: { advisorySectionId: section.id },
      select: { id: true },
    });
    await tx.user.updateMany({
      where: { advisorySectionId: section.id },
      data: { advisorySectionId: null },
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

    return [...new Set([...advisers.map((a) => a.id), ...teacherIds])];
  });

  await writeAudit({
    userId: user.id,
    schoolId: user.schoolId,
    action: AUDIT_ACTIONS.SECTION_DELETE,
    resource: "Section",
    resourceId: section.id,
    metadata: { schoolId: user.schoolId, sectionId: section.id, name: section.name },
  });

  revalidatePath(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
  revalidateSchoolHeadTeachers(user.schoolId);
  revalidateSchoolDashboard(user.schoolId);
  // `teacherGradeScope` resolves a teacher's grades from the section they advise
  // (`deletedAt: null` + `adviser`), and this transaction breaks that both ways:
  // it soft-deletes the section and nulls `advisorySectionId`. Nothing else here
  // busts a teacher tag, so the shell would keep offering a dead section for 300s
  // and the dashboard miscount for 60s. `TeacherSection` holders are included
  // defensively — no cached read consults that table today.
  for (const teacherId of affectedTeacherIds) {
    revalidateTeacherCaches(teacherId);
  }
  return { ok: true };
}, { verb: "delete the section" });

export const createNextLetterSection = action("createNextLetterSection", async (formData: FormData): Promise<ActionResult> => {
  const user = await requireSchoolUser("SCHOOL_HEAD");

  const gradeLevelId = String(formData.get("gradeLevelId") ?? "").trim();
  if (!gradeLevelId) throw fieldError("gradeLevelId", "Grade level required");

  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id: gradeLevelId,
      schoolId: user.schoolId,
      deletedAt: null,
    },
  });
  if (!grade) throw resourceNotFound("Grade level");

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
}, { verb: "create the section" });