import "server-only";
import type { AralMosyMoveOutReason, AralMosyOutcome, Prisma, ReadingProfile } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS, labelReadingProfile } from "@/lib/constants/enum-labels";
import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import {
  LEARNER_PAGE_SIZE,
  nameSearchWhere,
  sectionIdWhere,
  totalPages,
  type LearnerListSectionFilter,
} from "@/lib/learners/pagination";
import { readingProfileOptionsForGrade } from "@/lib/reading/policy";
import { mosyLearnerScope } from "@/lib/teachers/scope";
import {
  MOSY_STATUSES,
  computeMosyStats,
  formatPreviousLevel,
  mosyReasonChoices,
  mosyReasonLabel,
  mosyRowStatus,
  mosyStatusWhere,
  type MosyReasonChoice,
  type MosyRowStatus,
  type MosyStats,
  type MosyStatusFilter,
  type PreviousLevel,
} from "@/lib/aral/mosy";

/**
 * The one definition of a learner's "previous level" record: the latest reading
 * record on or after the school year start. The page renders it and the save
 * action validates the reason against it, so they cannot disagree.
 */
export function previousReadingLevelArgs(schoolYearStart: Date) {
  return {
    where: { weekStart: { gte: schoolYearStart } },
    orderBy: { weekStart: "desc" },
    take: 1,
    select: { weekStart: true, englishProfile: true, filipinoProfile: true },
  } as const satisfies Prisma.Learner$readingLevelsArgs;
}

/** Filipino profile of the previous-level record, or null. Caller scopes the learner to its school. */
export async function loadPreviousFilipinoLevel(
  tx: Prisma.TransactionClient,
  learnerId: string,
  schoolYearStart: Date
): Promise<string | null> {
  const args = previousReadingLevelArgs(schoolYearStart);
  const record = await tx.readingLevelRecord.findFirst({
    where: { learnerId, ...args.where },
    orderBy: args.orderBy,
    select: args.select,
  });
  return record?.filipinoProfile ?? null;
}

/** Plain, serializable row for the MOSY table. No `Date` crosses to the client. */
export type MosyRow = {
  id: string;
  fullName: string;
  gradeLevelId: string;
  gradeType: string;
  gradeLabel: string;
  sectionName: string | null;
  isAralLearner: boolean;
  status: MosyRowStatus;
  /** Levels this learner's grade may use, in rubric order. */
  levelOptions: { value: string; label: string }[];
  /** Move-out reasons offered to this learner (levels above the previous one, plus LSEN). */
  reasonChoices: MosyReasonChoice[];
  mosyLevel: ReadingProfile | null;
  mosyLevelLabel: string | null;
  decision: AralMosyOutcome | null;
  reason: AralMosyMoveOutReason | null;
  improvedToLevel: ReadingProfile | null;
  reasonLabel: string | null;
  remarks: string | null;
  previousLevel: PreviousLevel | null;
};

export type MosyPageData = {
  stats: MosyStats;
  counts: Record<MosyStatusFilter, number>;
  rows: MosyRow[];
  totalCount: number;
  page: number;
  pages: number;
  /** Grades present under the MOSY scope, in grade order, each with its live sections. */
  gradeOptions: MosyGradeOption[];
};

export type MosyGradeOption = {
  id: string;
  label: string;
  sections: { id: string; name: string }[];
};

const GRADE_ORDER = Object.keys(GRADE_LEVEL_LABELS);

export type LoadMosyPageArgs = {
  schoolId: string;
  schoolYear: { id: string; startDateKey: string };
  /** Tutor's user id, or `null` for the Super Admin whole-school read-only view. */
  teacherId: string | null;
  q: string;
  /** Grade level id, or "all"/"" for every grade. */
  grade: string;
  section: LearnerListSectionFilter;
  status: MosyStatusFilter;
  /** 1-based; clamped to the last page. */
  page: number;
};

/**
 * Server-side data for the MOSY Report page. Every `where` carries `schoolId`;
 * the tutor scope is `mosyLearnerScope`. The caller is responsible for deriving
 * `schoolId` / `teacherId` from the session (Super Admin: `?schoolId=`, `null`).
 */
export async function loadMosyPage(args: LoadMosyPageArgs): Promise<MosyPageData> {
  const { schoolId, schoolYear, teacherId, q, grade, section, status } = args;
  const scope = mosyLearnerScope(teacherId, schoolYear.id);

  const baseWhere: Prisma.LearnerWhereInput = {
    schoolId,
    deletedAt: null,
    archivedAt: null,
    AND: [scope],
  };
  const withStatus = (s: MosyStatusFilter, filtered: boolean): Prisma.LearnerWhereInput => ({
    schoolId,
    deletedAt: null,
    archivedAt: null,
    ...(filtered
      ? {
          ...nameSearchWhere(q),
          ...(grade && grade !== "all" ? { gradeLevelId: grade } : {}),
          ...sectionIdWhere(section),
        }
      : {}),
    AND: [scope, mosyStatusWhere(s, schoolYear.id)],
  });

  const [statusCounts, totalCount, gradeIdRows] = await Promise.all([
    Promise.all(MOSY_STATUSES.map((s) => prisma.learner.count({ where: withStatus(s, false) }))),
    prisma.learner.count({ where: withStatus(status, true) }),
    prisma.learner.findMany({
      where: baseWhere,
      select: { gradeLevelId: true, gradeLevel: { select: { type: true } } },
      distinct: ["gradeLevelId"],
    }),
  ]);

  const counts = Object.fromEntries(
    MOSY_STATUSES.map((s, i) => [s, statusCounts[i]])
  ) as Record<MosyStatusFilter, number>;

  const stats = computeMosyStats({
    total: counts.all,
    notUpdated: counts.not_updated,
    forDecision: counts.for_decision,
    movedOut: counts.moved_out,
    stay: counts.stay,
  });

  const pages = totalPages(totalCount, LEARNER_PAGE_SIZE);
  const page = Math.min(Math.max(1, Number.isFinite(args.page) ? Math.trunc(args.page) : 1), pages);

  const [learners, sectionRows] = await Promise.all([
    prisma.learner.findMany({
      relationLoadStrategy: "join",
      where: withStatus(status, true),
      select: {
        id: true,
        fullName: true,
        gradeLevelId: true,
        isAralLearner: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
        mosyDecisions: {
          where: { schoolYearId: schoolYear.id },
          take: 1,
          select: {
            mosyLevel: true,
            decision: true,
            reason: true,
            improvedToLevel: true,
            remarks: true,
            updatedAt: true,
          },
        },
        readingLevels: previousReadingLevelArgs(parseLocalDateKey(schoolYear.startDateKey)),
      },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      skip: (page - 1) * LEARNER_PAGE_SIZE,
      take: LEARNER_PAGE_SIZE,
    }),
    gradeIdRows.length > 0
      ? prisma.section.findMany({
          where: {
            schoolId,
            deletedAt: null,
            gradeLevelId: { in: gradeIdRows.map((g) => g.gradeLevelId) },
          },
          select: { id: true, name: true, gradeLevelId: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([] as { id: string; name: string; gradeLevelId: string }[]),
  ]);

  const gradeOptions: MosyGradeOption[] = gradeIdRows
    .map((g) => ({
      id: g.gradeLevelId,
      type: g.gradeLevel.type as string,
      label: GRADE_LEVEL_LABELS[g.gradeLevel.type] ?? g.gradeLevel.type,
      sections: sectionRows
        .filter((s) => s.gradeLevelId === g.gradeLevelId)
        .map((s) => ({ id: s.id, name: s.name })),
    }))
    .sort((a, b) => GRADE_ORDER.indexOf(a.type) - GRADE_ORDER.indexOf(b.type))
    .map(({ id, label, sections }) => ({ id, label, sections }));

  const rows: MosyRow[] = learners.map((l) => {
    const d = l.mosyDecisions[0] ?? null;
    const latest = l.readingLevels[0] ?? null;
    const gradeType = l.gradeLevel.type;
    return {
      id: l.id,
      fullName: l.fullName,
      gradeLevelId: l.gradeLevelId,
      gradeType,
      gradeLabel: GRADE_LEVEL_LABELS[gradeType] ?? gradeType,
      sectionName: l.section?.name ?? null,
      isAralLearner: l.isAralLearner,
      status: mosyRowStatus({ isAralLearner: l.isAralLearner, row: d }),
      levelOptions: readingProfileOptionsForGrade(gradeType),
      reasonChoices: mosyReasonChoices(gradeType, latest?.filipinoProfile ?? null),
      mosyLevel: d?.mosyLevel ?? null,
      mosyLevelLabel: d ? labelReadingProfile(d.mosyLevel, gradeType) : null,
      decision: d?.decision ?? null,
      reason: d?.reason ?? null,
      improvedToLevel: d?.improvedToLevel ?? null,
      reasonLabel: d?.reason ? mosyReasonLabel(d.reason, d.improvedToLevel, gradeType) : null,
      remarks: d?.remarks ?? null,
      previousLevel: formatPreviousLevel(
        latest
          ? {
              monthKey: formatLocalDateKey(latest.weekStart),
              englishProfile: latest.englishProfile,
              filipinoProfile: latest.filipinoProfile,
            }
          : null,
        gradeType
      ),
    };
  });

  return { stats, counts, rows, totalCount, page, pages, gradeOptions };
}
