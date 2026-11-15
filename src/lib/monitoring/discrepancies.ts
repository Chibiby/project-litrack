import "server-only";
import { prismaFresh } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolDashboard, schoolTeacherTasks } from "@/lib/cache/tags";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { formatListingNameFromRecord } from "@/lib/names";
import {
  classifyDiscrepancies,
  type DiscrepancyFacts,
} from "@/lib/monitoring/discrepancy-rules";
import type { DiscrepancySummary } from "@/lib/monitoring/discrepancy-kinds";

/**
 * Monitoring > Discrepancies — gathering the facts for ONE school.
 *
 * Four reads, whatever the school's size, each carrying `schoolId`. The rules
 * that decide what is a discrepancy are pure (`discrepancy-rules.ts`).
 * `prismaFresh`, because the page shows other people's saves.
 */
async function gatherDiscrepancyFacts(schoolId: string): Promise<DiscrepancyFacts> {
  const db = prismaFresh;
  const userSelect = {
    id: true,
    firstName: true,
    middleName: true,
    lastName: true,
    isActive: true,
    deletedAt: true,
    approvalStatus: true,
    schoolId: true,
  } as const;

  const [learners, sections, activeYear] = await Promise.all([
    db.learner.findMany({
      where: { schoolId, deletedAt: null, archivedAt: null },
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        gradeLevelId: true,
        sectionId: true,
        teacherId: true,
        aralTeacherId: true,
        isAralLearner: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true, gradeLevelId: true, adviserId: true, deletedAt: true } },
        teacher: { select: userSelect },
        aralTeacher: { select: userSelect },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    }),
    db.section.findMany({
      where: { schoolId, deletedAt: null, gradeLevel: { deletedAt: null } },
      select: {
        id: true,
        name: true,
        gradeLevel: { select: { type: true } },
        adviser: { select: userSelect },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
    db.schoolYear.findFirst({
      where: { schoolId, isActive: true },
      select: { id: true },
    }),
  ]);

  const enrollments = activeYear
    ? await db.enrollment.findMany({
        where: { schoolId, schoolYearId: activeYear.id, status: "ACTIVE" },
        select: { learnerId: true, gradeLevelId: true, sectionId: true },
      })
    : [];

  const gradeLabel = (type: string) =>
    (GRADE_LEVEL_LABELS as Record<string, string>)[type] ?? type;
  const person = (
    u: { firstName: string; middleName: string | null; lastName: string; isActive: boolean; deletedAt: Date | null; approvalStatus: string | null; schoolId: string | null } | null
  ) =>
    u
      ? {
          name: formatListingNameFromRecord(u),
          active:
            u.isActive && u.deletedAt === null && u.approvalStatus === "APPROVED" && u.schoolId === schoolId,
        }
      : null;

  return {
    hasActiveYear: activeYear !== null,
    learners: learners.map((l) => ({
      id: l.id,
      name: formatListingNameFromRecord(l),
      gradeLevelId: l.gradeLevelId,
      gradeLabel: gradeLabel(l.gradeLevel.type),
      sectionId: l.section && l.section.deletedAt === null ? l.sectionId : null,
      sectionName: l.section && l.section.deletedAt === null ? l.section.name : null,
      sectionGradeLevelId: l.section && l.section.deletedAt === null ? l.section.gradeLevelId : null,
      sectionAdviserId: l.section && l.section.deletedAt === null ? l.section.adviserId : null,
      teacherId: l.teacherId,
      teacher: person(l.teacher),
      isAralLearner: l.isAralLearner,
      aralTeacherId: l.aralTeacherId,
      aralTeacher: person(l.aralTeacher),
    })),
    sections: sections.map((s) => ({
      id: s.id,
      name: s.name,
      gradeLabel: gradeLabel(s.gradeLevel.type),
      adviser: person(s.adviser),
    })),
    enrollments,
  };
}

/**
 * The Discrepancies summary for a school, from the Data Cache (60 seconds).
 * Busted with the dashboard tag, so learner and teacher changes show at once.
 */
export async function getDiscrepancySummary(schoolId: string): Promise<DiscrepancySummary> {
  return cachedQuery(async () => classifyDiscrepancies(await gatherDiscrepancyFacts(schoolId)), {
    keyParts: ["school-discrepancies-v1", schoolId],
    tags: [schoolTeacherTasks(schoolId), schoolDashboard(schoolId)],
    revalidate: 60,
  });
}
