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
import { formatListingNameFromRecord } from "@/lib/names";
import { readingProfileOptionsForGrade } from "@/lib/reading/policy";
import { mosyLearnerScope } from "@/lib/teachers/scope";
import {
  MOSY_STATUSES,
  computeMosyStats,
  formatPreviousLevel,
  mosyLevelLanguage,
  mosyReasonChoices,
  mosyReasonLabel,
  mosyRowStatus,
  mosyStatusWhere,
  type MosyLevelLanguage,
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
  /** Language the MOSY level is read in: Filipino for Kinder to G2, English above. */
  mosyLanguage: MosyLevelLanguage;
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

export type LoadMosyPageArgs = {
  schoolId: string;
  schoolYear: { id: string; startDateKey: string };
  /**
   * The teacher's advisory section ids (`resolveMosyAccess`), or `null` for the
   * Super Admin whole-school read-only view.
   */
  sectionIds: string[] | null;
  q: string;
  /** Grade level id, or "all"/"" for every grade. */
  grade: string;
  section: LearnerListSectionFilter;
  status: MosyStatusFilter;
  /** 1-based; clamped to the last page. */
  page: number;
};

type MosyWhereArgs = {
  schoolId: string;
  schoolYearId: string;
  sectionIds: string[] | null;
  q: string;
  grade: string;
  section: LearnerListSectionFilter;
};

/**
 * The one definition of "which learners the MOSY list shows". The page and the
 * Excel/PDF export both build their `where` here, so they cannot disagree.
 * `filtered: false` drops q / grade / section (the status-tab counts and the
 * stat cards ignore them).
 */
function mosyListWhere(
  args: MosyWhereArgs,
  status: MosyStatusFilter,
  filtered: boolean
): Prisma.LearnerWhereInput {
  return {
    schoolId: args.schoolId,
    deletedAt: null,
    archivedAt: null,
    ...(filtered
      ? {
          ...nameSearchWhere(args.q),
          ...(args.grade && args.grade !== "all" ? { gradeLevelId: args.grade } : {}),
          ...sectionIdWhere(args.section),
        }
      : {}),
    AND: [mosyLearnerScope(args.sectionIds, args.schoolYearId), mosyStatusWhere(status, args.schoolYearId)],
  };
}

/** Per-status learner counts over the whole MOSY scope (filters ignored). */
async function countMosyStatuses(args: MosyWhereArgs): Promise<Record<MosyStatusFilter, number>> {
  const statusCounts = await Promise.all(
    MOSY_STATUSES.map((s) => prisma.learner.count({ where: mosyListWhere(args, s, false) }))
  );
  return Object.fromEntries(MOSY_STATUSES.map((s, i) => [s, statusCounts[i]])) as Record<
    MosyStatusFilter,
    number
  >;
}

function statsFromCounts(counts: Record<MosyStatusFilter, number>): MosyStats {
  return computeMosyStats({
    total: counts.all,
    notUpdated: counts.not_updated,
    forDecision: counts.for_decision,
    movedOut: counts.moved_out,
    stay: counts.stay,
  });
}

/** The learner columns both the page and the export read. */
function mosyRowSelect(schoolYear: { id: string; startDateKey: string }) {
  return {
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
  } as const satisfies Prisma.LearnerSelect;
}

type MosyLearnerRecord = Prisma.LearnerGetPayload<{
  select: ReturnType<typeof mosyRowSelect>;
}>;

function toMosyRow(l: MosyLearnerRecord): MosyRow {
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
    mosyLanguage: mosyLevelLanguage(gradeType),
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
}

/**
 * Grade levels in `GradeLevelType` (prisma enum) order: Kinder, Grade 1 ...
 * Grade 12. Spelled out rather than read off an object's key order so the filter
 * order cannot change by accident. A type not listed sorts last.
 */
export const MOSY_GRADE_TYPE_ORDER: readonly string[] = [
  "KINDER", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "FLOATING",
];

function gradeRank(type: string): number {
  const i = MOSY_GRADE_TYPE_ORDER.indexOf(type);
  return i === -1 ? MOSY_GRADE_TYPE_ORDER.length : i;
}

/**
 * Pure, deterministic builder for the grade/section filter options: grades in
 * `GradeLevelType` order (ties by id), each grade's sections by name (ties by
 * id). A section whose grade is not in `grades` is dropped.
 */
export function buildMosyGradeOptions(
  grades: { id: string; type: string }[],
  sections: { id: string; name: string; gradeLevelId: string }[]
): MosyGradeOption[] {
  return [...grades]
    .sort((a, b) => gradeRank(a.type) - gradeRank(b.type) || a.id.localeCompare(b.id))
    .map((g) => ({
      id: g.id,
      label: GRADE_LEVEL_LABELS[g.type] ?? g.type,
      sections: sections
        .filter((s) => s.gradeLevelId === g.id)
        .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }) || a.id.localeCompare(b.id))
        .map((s) => ({ id: s.id, name: s.name })),
    }));
}

/**
 * The filter options inside the MOSY scope. A teacher (`sectionIds` set) sees
 * only their own advisory sections and those sections' grades, whether or not a
 * section currently holds an in-scope learner. The whole-school view lists the
 * grades that have in-scope learners, with every live section of each. Every
 * query pins `schoolId`.
 */
async function loadMosyGradeOptions(
  schoolId: string,
  sectionIds: string[] | null,
  baseWhere: Prisma.LearnerWhereInput
): Promise<MosyGradeOption[]> {
  if (sectionIds) {
    if (sectionIds.length === 0) return [];
    const sections = await prisma.section.findMany({
      where: { schoolId, deletedAt: null, id: { in: sectionIds } },
      select: { id: true, name: true, gradeLevelId: true, gradeLevel: { select: { type: true } } },
    });
    const grades = new Map<string, { id: string; type: string }>();
    for (const s of sections) grades.set(s.gradeLevelId, { id: s.gradeLevelId, type: s.gradeLevel.type });
    return buildMosyGradeOptions([...grades.values()], sections);
  }

  const gradeRows = await prisma.learner.findMany({
    where: baseWhere,
    select: { gradeLevelId: true, gradeLevel: { select: { type: true } } },
    distinct: ["gradeLevelId"],
  });
  if (gradeRows.length === 0) return [];
  const sections = await prisma.section.findMany({
    where: {
      schoolId,
      deletedAt: null,
      gradeLevelId: { in: gradeRows.map((g) => g.gradeLevelId) },
    },
    select: { id: true, name: true, gradeLevelId: true },
  });
  return buildMosyGradeOptions(
    gradeRows.map((g) => ({ id: g.gradeLevelId, type: g.gradeLevel.type })),
    sections
  );
}

/**
 * Server-side data for the MOSY Report page. Every `where` carries `schoolId`;
 * the advisory scope is `mosyLearnerScope`. The caller is responsible for
 * deriving `schoolId` / `sectionIds` from the session (`resolveMosyAccess`;
 * Super Admin: `?schoolId=`, `null`).
 */
export async function loadMosyPage(args: LoadMosyPageArgs): Promise<MosyPageData> {
  const { schoolId, schoolYear, sectionIds, q, grade, section, status } = args;
  const whereArgs: MosyWhereArgs = {
    schoolId,
    schoolYearId: schoolYear.id,
    sectionIds,
    q,
    grade,
    section,
  };

  const baseWhere: Prisma.LearnerWhereInput = {
    schoolId,
    deletedAt: null,
    archivedAt: null,
    AND: [mosyLearnerScope(sectionIds, schoolYear.id)],
  };

  const [counts, totalCount, gradeOptions] = await Promise.all([
    countMosyStatuses(whereArgs),
    prisma.learner.count({ where: mosyListWhere(whereArgs, status, true) }),
    loadMosyGradeOptions(schoolId, sectionIds, baseWhere),
  ]);

  const stats = statsFromCounts(counts);

  const pages = totalPages(totalCount, LEARNER_PAGE_SIZE);
  const page = Math.min(Math.max(1, Number.isFinite(args.page) ? Math.trunc(args.page) : 1), pages);

  const learners = await prisma.learner.findMany({
    relationLoadStrategy: "join",
    where: mosyListWhere(whereArgs, status, true),
    select: mosyRowSelect(schoolYear),
    orderBy: [{ fullName: "asc" }, { id: "asc" }],
    skip: (page - 1) * LEARNER_PAGE_SIZE,
    take: LEARNER_PAGE_SIZE,
  });

  const rows: MosyRow[] = learners.map(toMosyRow);

  return { stats, counts, rows, totalCount, page, pages, gradeOptions };
}

/**
 * Most rows one Excel/PDF export carries. Same bound `buildMosyTable` puts on
 * the Reports Hub MOSY read (5000), and far above any one adviser's MOSY list.
 */
export const MOSY_EXPORT_MAX_ROWS = 5000;

/** A `MosyRow` plus the surname-first name DepEd lists use ("Cruz, Juan Dela"). */
export type MosyExportRow = MosyRow & { listingName: string };

export type LoadMosyExportArgs = Omit<LoadMosyPageArgs, "page">;

export type MosyExportData = {
  /** The five page stat cards: whole MOSY scope, filters ignored, exactly as the page shows them. */
  stats: MosyStats;
  /** Every row matching the filters, in listing order, at most `MOSY_EXPORT_MAX_ROWS`. */
  rows: MosyExportRow[];
  /** Rows matching the filters before the cap. `totalCount > rows.length` means the list was cut. */
  totalCount: number;
  truncated: boolean;
  /** Human labels for the filters, for the report header. `null` = not filtered. */
  gradeLabel: string | null;
  sectionLabel: string | null;
};

/**
 * Every row the MOSY page would show for these filters, not paginated, for the
 * Excel/PDF export. Uses the same `mosyListWhere`, `mosyRowSelect` and
 * `toMosyRow` as `loadMosyPage`, so the file and the screen cannot disagree.
 * Beyond `MOSY_EXPORT_MAX_ROWS` the list is cut (`truncated: true`) and the
 * report says so; the stats are unaffected.
 *
 * Ordered by surname (then given name) because the export prints surname-first
 * names; the page orders by `fullName`.
 *
 * Tenancy: every `where` carries `schoolId`, including the grade and section
 * label lookups, so a foreign grade or section id yields no rows and no label.
 */
export async function loadMosyExport(args: LoadMosyExportArgs): Promise<MosyExportData> {
  const { schoolId, schoolYear, sectionIds, q, grade, section, status } = args;
  const whereArgs: MosyWhereArgs = {
    schoolId,
    schoolYearId: schoolYear.id,
    sectionIds,
    q,
    grade,
    section,
  };
  const gradeFiltered = !!grade && grade !== "all";
  const sectionFiltered = section !== "all" && section !== "none";

  const [counts, totalCount, learners, gradeRow, sectionRow] = await Promise.all([
    countMosyStatuses(whereArgs),
    prisma.learner.count({ where: mosyListWhere(whereArgs, status, true) }),
    prisma.learner.findMany({
      relationLoadStrategy: "join",
      where: mosyListWhere(whereArgs, status, true),
      select: {
        ...mosyRowSelect(schoolYear),
        firstName: true,
        middleName: true,
        lastName: true,
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
      take: MOSY_EXPORT_MAX_ROWS,
    }),
    gradeFiltered
      ? prisma.gradeLevel.findFirst({
          where: { id: grade, schoolId, deletedAt: null },
          select: { type: true },
        })
      : Promise.resolve(null),
    sectionFiltered
      ? prisma.section.findFirst({
          // A teacher only gets the label of one of their own sections; another
          // section of the same school must not have its name printed.
          where: {
            id: sectionIds ? { equals: section, in: sectionIds } : section,
            schoolId,
            deletedAt: null,
          },
          select: { name: true },
        })
      : Promise.resolve(null),
  ]);

  return {
    stats: statsFromCounts(counts),
    rows: learners.map((l) => ({ ...toMosyRow(l), listingName: formatListingNameFromRecord(l) })),
    totalCount,
    truncated: totalCount > learners.length,
    gradeLabel: gradeRow ? (GRADE_LEVEL_LABELS[gradeRow.type] ?? gradeRow.type) : null,
    sectionLabel: section === "none" ? "No section" : (sectionRow?.name ?? null),
  };
}
