import "server-only";

import type { GradeLevelType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { formatListingNameFromRecord } from "@/lib/names";
import { masterlistSources, type EnrollmentOutcomeValue } from "@/lib/learners/masterlist-grades";

/**
 * The enroll masterlist: learners at one school who finished a past school year
 * with an outcome (promoted or retained) and have not been enrolled into the
 * current active year yet.
 *
 * A learner is on it when ALL hold:
 * - live (`deletedAt` and `archivedAt` null) and still at this school;
 * - their most recent enrollment carries an outcome, was at this school, and is
 *   not in the active year;
 * - they have no ACTIVE enrollment in the active year.
 *
 * Filtered to one target grade: that grade's retained learners plus the grade
 * below's promoted ones (see `masterlistSources`).
 */
export type MasterlistEntry = {
  learnerId: string;
  name: string;
  gender: string;
  /** Past enrollment's grade, e.g. "Grade 4". */
  fromGradeLabel: string;
  fromSectionName: string | null;
  outcome: EnrollmentOutcomeValue;
  /** The past school year's label, e.g. "2025-2026". */
  fromYearLabel: string;
};

export async function getMasterlist(opts: {
  schoolId: string;
  activeSchoolYearId: string;
  targetGradeType: string;
  q?: string;
  /** Restrict to these learners (the enroll action re-checks its selection). */
  learnerIds?: string[];
  take?: number;
}): Promise<MasterlistEntry[]> {
  const sources = masterlistSources(opts.targetGradeType);
  if (sources.length === 0) return [];

  const q = opts.q?.trim();
  const learnerWhere: Prisma.LearnerWhereInput = {
    schoolId: opts.schoolId,
    deletedAt: null,
    archivedAt: null,
    enrollments: { none: { schoolYearId: opts.activeSchoolYearId, status: "ACTIVE" } },
    ...(opts.learnerIds ? { id: { in: opts.learnerIds } } : {}),
    ...(q ? { fullName: { contains: q, mode: "insensitive" } } : {}),
  };

  const candidates = await prisma.enrollment.findMany({
    where: {
      schoolId: opts.schoolId,
      schoolYearId: { not: opts.activeSchoolYearId },
      OR: sources.map((s) => ({
        outcome: s.outcome,
        gradeLevel: { type: s.gradeType as GradeLevelType },
      })),
      learner: learnerWhere,
    },
    orderBy: [{ enrolledAt: "desc" }],
    take: opts.take ?? 500,
    select: {
      id: true,
      learnerId: true,
      outcome: true,
      enrolledAt: true,
      gradeLevel: { select: { type: true } },
      section: { select: { name: true } },
      schoolYear: { select: { label: true } },
      learner: {
        select: { firstName: true, middleName: true, lastName: true, gender: true },
      },
    },
  });
  if (candidates.length === 0) return [];

  // The candidate must be the learner's latest enrollment: a learner enrolled
  // again somewhere later (another year, another grade) is no longer waiting.
  const learnerIds = [...new Set(candidates.map((c) => c.learnerId))];
  const latest = await prisma.enrollment.findMany({
    where: { learnerId: { in: learnerIds } },
    orderBy: [{ learnerId: "asc" }, { enrolledAt: "desc" }],
    distinct: ["learnerId"],
    select: { id: true, learnerId: true },
  });
  const latestId = new Map(latest.map((l) => [l.learnerId, l.id]));

  const seen = new Set<string>();
  const rows: MasterlistEntry[] = [];
  for (const c of candidates) {
    if (seen.has(c.learnerId) || latestId.get(c.learnerId) !== c.id || !c.outcome) continue;
    seen.add(c.learnerId);
    rows.push({
      learnerId: c.learnerId,
      name: formatListingNameFromRecord(c.learner),
      gender: c.learner.gender,
      fromGradeLabel: GRADE_LEVEL_LABELS[c.gradeLevel.type] ?? c.gradeLevel.type,
      fromSectionName: c.section?.name ?? null,
      outcome: c.outcome,
      fromYearLabel: c.schoolYear.label,
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** A learner in an advisory this year, with the outcome saved so far. */
export type PromotionRosterEntry = {
  learnerId: string;
  name: string;
  gender: string;
  outcome: EnrollmentOutcomeValue | null;
};

/** The advisory's learners with an ACTIVE enrollment in the active year. */
export async function getPromotionRoster(opts: {
  schoolId: string;
  schoolYearId: string;
  sectionId: string;
}): Promise<PromotionRosterEntry[]> {
  const rows = await prisma.enrollment.findMany({
    where: {
      schoolId: opts.schoolId,
      schoolYearId: opts.schoolYearId,
      sectionId: opts.sectionId,
      status: "ACTIVE",
      learner: { deletedAt: null, archivedAt: null },
    },
    select: {
      learnerId: true,
      outcome: true,
      learner: { select: { firstName: true, middleName: true, lastName: true, gender: true } },
    },
  });
  return rows
    .map((r) => ({
      learnerId: r.learnerId,
      name: formatListingNameFromRecord(r.learner),
      gender: r.learner.gender,
      outcome: r.outcome,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
