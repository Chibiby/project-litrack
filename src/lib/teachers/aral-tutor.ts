import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolTeachers } from "@/lib/cache/tags";
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

/**
 * Every teacher who may be designated, by surname — one order for every picker.
 *
 * Cached here rather than at the call sites, so all four readers share one entry:
 * the ARAL dashboard, the enroll control on the two ARAL grade sheets, the School
 * Head ARAL tab, and the `listAralTutorOptions` action behind the on-demand
 * picker. Keyed on `schoolId` alone because that is the whole of the `where`
 * besides fixed literals — nothing here is teacher-scoped, so no `teacherId` or
 * `isSuperAdmin` part would discriminate anything.
 *
 * `schoolTeachers(schoolId)` is busted by `revalidateSchoolHeadTeachers`, which
 * every teacher approve / reject / clear / deactivate / remove, profile save and
 * advisory reassignment already calls. A section *rename* also changes
 * `advisoryLabel`, and it touches no `User` row at all, so it reaches none of
 * those paths — `updateSection` therefore busts this tag directly via
 * `revalidateSchoolTeachers`. Both halves of `advisoryLabel` are covered as a
 * result: who advises what, and what the section is called.
 *
 * Returns `AralTutorOption[]`, which holds no `Date`: `advisorySection.deletedAt`
 * is selected but collapsed to a truthiness check below and never escapes, so
 * nothing here can arrive back from the JSON round trip as a string with `Date`
 * methods called on it.
 */
export async function listAralTutors(schoolId: string): Promise<AralTutorOption[]> {
  return cachedQuery(
    async () => {
      const teachers = await prisma.user.findMany({
        relationLoadStrategy: "join",
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
    },
    {
      keyParts: ["aral-tutors-v1", schoolId],
      tags: [schoolTeachers(schoolId)],
      profile: "volatile",
    }
  );
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
