import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

/**
 * Who may be designated the ARAL tutor for a learner.
 *
 * ANY teacher at the school qualifies, DepEd plantilla or not, with or without an
 * advisory section. That is the point of the designation: it is the axis that lets
 * a volunteer or an ARAL-only teacher work on ARAL learners.
 *
 * The `where` fragment and the list read below share this one definition on
 * purpose. When the picker's list is built from a wider rule than the action
 * validates against, the interface offers people the action then refuses — the
 * exact failure the grade dropdown used to produce.
 */
export function aralTutorScope(schoolId: string): Prisma.UserWhereInput {
  return {
    schoolId,
    role: "TEACHER",
    deletedAt: null,
    isActive: true,
    approvalStatus: "APPROVED",
  };
}

export type AralTutorOption = {
  id: string;
  name: string;
  /** "Grade 3 · Sampaguita", or null for a teacher who advises nothing. */
  advisoryLabel: string | null;
  /**
   * DepEd plantilla or not, `null` when the profile predates the question.
   *
   * DISPLAY ONLY — it is shown so the person choosing can see who they are
   * picking, and it never narrows this list.
   */
  employmentType: "DEPED_PLANTILLA" | "NON_DEPED" | null;
};

/** Every teacher who may be designated, by surname — one order for every picker. */
export async function listAralTutors(schoolId: string): Promise<AralTutorOption[]> {
  const teachers = await prisma.user.findMany({
    where: aralTutorScope(schoolId),
    select: {
      id: true,
      fullName: true,
      firstName: true,
      lastName: true,
      teacherProfile: { select: { employmentType: true } },
      advisorySection: {
        select: {
          name: true,
          deletedAt: true,
          gradeLevel: { select: { type: true } },
        },
      },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  return teachers.map((t) => {
    const advisory =
      t.advisorySection && !t.advisorySection.deletedAt
        ? `${GRADE_LEVEL_LABELS[t.advisorySection.gradeLevel.type] ?? t.advisorySection.gradeLevel.type} · ${t.advisorySection.name}`
        : null;

    return {
      id: t.id,
      name:
        t.fullName?.trim() ||
        [t.firstName, t.lastName].filter(Boolean).join(" ").trim() ||
        "Unnamed teacher",
      advisoryLabel: advisory,
      employmentType: t.teacherProfile?.employmentType ?? null,
    };
  });
}

/** True when this id is a teacher at this school who may hold a designation. */
export async function isEligibleAralTutor(
  teacherId: string,
  schoolId: string
): Promise<boolean> {
  const teacher = await prisma.user.findFirst({
    where: { id: teacherId, ...aralTutorScope(schoolId) },
    select: { id: true },
  });
  return teacher != null;
}
