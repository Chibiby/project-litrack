import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { originalTeacherEmail } from "@/lib/teachers/removed-email";
import type { LearnerPurgeCounts } from "@/lib/archive/purge";

/** The counts the admin dialog shows; the audit row also records the two newer tables. */
export type AdminPurgeCounts = Omit<LearnerPurgeCounts, "aralMosyDecision" | "kinderCompetencyRecord">;
import { assertOrderByCoversOptions } from "@/lib/sort/registry";
import {
  ARCHIVE_LEARNER_SORTS,
  ARCHIVE_TEACHER_SORTS,
  type ArchiveLearnerSort,
  type ArchiveTeacherSort,
} from "./archive-sorts";
import { formatListingNameFromRecord } from "@/lib/names";

/**
 * The read model behind `/admin/archive` — every soft-deleted Teacher and
 * Learner across every school, for a Super Admin to restore or permanently
 * delete one row at a time.
 *
 * Deliberately uncached: no `cachedQuery`, matching `getSchoolDetail`
 * (`src/lib/admin/school-detail.ts`). This is the page an admin reads
 * immediately before deleting what it lists, and a stale row — even for a
 * short TTL — would be misread as the result of the restore or purge they
 * just performed on the row next to it.
 *
 * Rows whose school is itself soft-deleted are included, flagged via
 * `schoolDeleted`, rather than filtered out: hiding them would make the page
 * lie, and a school that no longer exists is the likeliest purge candidate on
 * the whole page (spec section 5).
 */

export const ARCHIVE_PAGE_SIZE = 50;

/**
 * Both buckets' option lists live in `./archive-sorts`, a Prisma-free module,
 * because the archive view is a client component and needs them at runtime to
 * render its dropdowns. Re-exported here so server-side callers still have a
 * single import site.
 */
export {
  ARCHIVE_TEACHER_SORTS,
  ARCHIVE_LEARNER_SORTS,
  type ArchiveTeacherSort,
  type ArchiveLearnerSort,
} from "./archive-sorts";

/**
 * The primary `orderBy` clause per sort option, without the tiebreaker. Kept
 * alongside `ARCHIVE_TEACHER_SORTS` so an option added to one and not the
 * other is a build-time (`satisfies`) and test-time
 * (`assertOrderByCoversOptions`) failure rather than a silently unsorted table.
 */
const ARCHIVE_TEACHER_SORT_ORDER_BY = {
  recent: [{ deletedAt: "desc" }],
  alphabetical: [{ lastName: "asc" }, { firstName: "asc" }],
  school: [{ school: { name: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
} satisfies Record<ArchiveTeacherSort, Prisma.UserOrderByWithRelationInput[]>;

assertOrderByCoversOptions(ARCHIVE_TEACHER_SORTS, ARCHIVE_TEACHER_SORT_ORDER_BY);

const ARCHIVE_LEARNER_SORT_ORDER_BY = {
  recent: [{ deletedAt: "desc" }],
  alphabetical: [{ lastName: "asc" }, { firstName: "asc" }],
  school: [{ school: { name: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
} satisfies Record<ArchiveLearnerSort, Prisma.LearnerOrderByWithRelationInput[]>;

assertOrderByCoversOptions(ARCHIVE_LEARNER_SORTS, ARCHIVE_LEARNER_SORT_ORDER_BY);

/**
 * Prisma `orderBy` array for a parsed removed-teachers sort, always ending in
 * the `id` tiebreaker. This bucket is server-paginated with skip/take —
 * `school` is not a unique key, and even `recent` (`deletedAt`) can collide
 * when rows are removed in the same batch, so without the tiebreaker Postgres
 * can repeat or skip a row across pages.
 */
export function archiveTeacherOrderBy(
  sort: ArchiveTeacherSort
): Prisma.UserOrderByWithRelationInput[] {
  return [...ARCHIVE_TEACHER_SORT_ORDER_BY[sort], { id: "asc" }];
}

/** Same tiebreaker reasoning as `archiveTeacherOrderBy`, for the learners bucket. */
export function archiveLearnerOrderBy(
  sort: ArchiveLearnerSort
): Prisma.LearnerOrderByWithRelationInput[] {
  return [...ARCHIVE_LEARNER_SORT_ORDER_BY[sort], { id: "asc" }];
}

export type ArchivedTeacherRow = {
  id: string;
  fullName: string;
  /**
   * Surname-first display form ("Lastname, Firstname Middlename"), built from
   * `firstName`/`middleName`/`lastName` via `formatListingNameFromRecord` —
   * never by parsing `fullName` apart. `fullName` keeps its existing shape:
   * search and dedupe depend on that stored value, so this is an added
   * display field, not a replacement.
   */
  listingName: string;
  schoolId: string | null;
  schoolName: string | null;
  /** True when the teacher's own school has been soft-deleted. */
  schoolDeleted: boolean;
  deletedAt: string;
  /** `null` when the tombstone does not keep a recoverable original address. */
  originalEmail: string | null;
};

export type ArchivedLearnerRow = {
  id: string;
  fullName: string;
  /** Surname-first display form — see `ArchivedTeacherRow.listingName`. */
  listingName: string;
  schoolId: string;
  schoolName: string;
  /** True when the learner's own school has been soft-deleted. */
  schoolDeleted: boolean;
  gradeLevel: string;
  section: string | null;
  isAralLearner: boolean;
  deletedAt: string;
  purgeCounts: AdminPurgeCounts;
};

export type ArchivePage<T> = {
  rows: T[];
  page: number;
  pages: number;
  total: number;
};

export type ArchiveParams = {
  /** School id, or undefined for every school. */
  school?: string;
  /** Name `contains`, case-insensitive. */
  q?: string;
  teacherPage?: number;
  learnerPage?: number;
  /**
   * Raw `?teachersSort=` value, parsed with `ARCHIVE_TEACHER_SORTS.parse`
   * (garbage/undefined falls back to `"recent"`). A distinct param name from
   * `learnersSort` — the two buckets sort independently.
   */
  teachersSort?: string;
  /** Raw `?learnersSort=` value, parsed with `ARCHIVE_LEARNER_SORTS.parse`. */
  learnersSort?: string;
};

export type Archive = {
  teachers: ArchivePage<ArchivedTeacherRow>;
  learners: ArchivePage<ArchivedLearnerRow>;
};

function normalizePage(page: number | undefined): number {
  return Number.isFinite(page) && (page as number) > 0 ? Math.floor(page as number) : 1;
}

/**
 * Per-learner counts for the permanent-delete dialog. One `groupBy` per
 * relation over the page's ids, not a count query per row: 5 queries total.
 */
export async function learnerPurgeCounts(learnerIds: string[]): Promise<Map<string, AdminPurgeCounts>> {
  if (learnerIds.length === 0) return new Map();
  const where = { learnerId: { in: learnerIds } };
  const [enrollment, attendance, readingLevel, termGrade, aralProfile] = await Promise.all([
    prisma.enrollment.groupBy({ by: ["learnerId"], where, _count: { _all: true } }),
    prisma.attendance.groupBy({ by: ["learnerId"], where, _count: { _all: true } }),
    prisma.readingLevelRecord.groupBy({ by: ["learnerId"], where, _count: { _all: true } }),
    prisma.termGrade.groupBy({ by: ["learnerId"], where, _count: { _all: true } }),
    prisma.aralProfile.groupBy({ by: ["learnerId"], where, _count: { _all: true } }),
  ]);
  const toMap = (rows: { learnerId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.learnerId, r._count._all]));
  const e = toMap(enrollment);
  const a = toMap(attendance);
  const r = toMap(readingLevel);
  const t = toMap(termGrade);
  const p = toMap(aralProfile);
  return new Map(
    learnerIds.map((id) => [
      id,
      {
        enrollment: e.get(id) ?? 0,
        attendance: a.get(id) ?? 0,
        readingLevelRecord: r.get(id) ?? 0,
        termGrade: t.get(id) ?? 0,
        aralProfile: p.get(id) ?? 0,
      } satisfies AdminPurgeCounts,
    ])
  );
}

/** Soft-deleted teachers, `deletedAt DESC` by default, 50 per page. */
export async function getArchivedTeachers(
  params: Pick<ArchiveParams, "school" | "q" | "teacherPage" | "teachersSort">
): Promise<ArchivePage<ArchivedTeacherRow>> {
  const teacherPage = normalizePage(params.teacherPage);
  const teachersSort = ARCHIVE_TEACHER_SORTS.parse(params.teachersSort);
  const where: Prisma.UserWhereInput = {
    role: "TEACHER",
    deletedAt: { not: null },
    ...(params.school ? { schoolId: params.school } : {}),
    ...(params.q ? { fullName: { contains: params.q, mode: "insensitive" as const } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        firstName: true,
        middleName: true,
        lastName: true,
        email: true,
        deletedAt: true,
        school: { select: { id: true, name: true, deletedAt: true } },
      },
      orderBy: archiveTeacherOrderBy(teachersSort),
      skip: (teacherPage - 1) * ARCHIVE_PAGE_SIZE,
      take: ARCHIVE_PAGE_SIZE,
    }),
  ]);

  return {
    rows: rows.map((t) => ({
      id: t.id,
      fullName: t.fullName,
      listingName: formatListingNameFromRecord(t),
      schoolId: t.school?.id ?? null,
      schoolName: t.school?.name ?? null,
      schoolDeleted: t.school?.deletedAt != null,
      deletedAt: (t.deletedAt as Date).toISOString(),
      originalEmail: originalTeacherEmail(t.email),
    })),
    page: teacherPage,
    pages: Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE)),
    total,
  };
}

/** Soft-deleted learners across every school, with purge counts. */
async function getArchivedLearners(
  params: Pick<ArchiveParams, "school" | "q" | "learnerPage" | "learnersSort">
): Promise<ArchivePage<ArchivedLearnerRow>> {
  const learnerPage = normalizePage(params.learnerPage);
  const learnersSort = ARCHIVE_LEARNER_SORTS.parse(params.learnersSort);
  const where: Prisma.LearnerWhereInput = {
    deletedAt: { not: null },
    ...(params.school ? { schoolId: params.school } : {}),
    ...(params.q ? { fullName: { contains: params.q, mode: "insensitive" as const } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.learner.count({ where }),
    prisma.learner.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        firstName: true,
        middleName: true,
        lastName: true,
        isAralLearner: true,
        deletedAt: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
        school: { select: { id: true, name: true, deletedAt: true } },
      },
      orderBy: archiveLearnerOrderBy(learnersSort),
      skip: (learnerPage - 1) * ARCHIVE_PAGE_SIZE,
      take: ARCHIVE_PAGE_SIZE,
    }),
  ]);
  const counts = await learnerPurgeCounts(rows.map((l) => l.id));

  return {
    rows: rows.map((l) => ({
      id: l.id,
      fullName: l.fullName,
      listingName: formatListingNameFromRecord(l),
      schoolId: l.school.id,
      schoolName: l.school.name,
      schoolDeleted: l.school.deletedAt != null,
      gradeLevel: GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
      section: l.section?.name ?? null,
      isAralLearner: l.isAralLearner,
      deletedAt: (l.deletedAt as Date).toISOString(),
      purgeCounts: counts.get(l.id)!,
    })),
    page: learnerPage,
    pages: Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE)),
    total,
  };
}

/** Two independently paginated lists, both `deletedAt DESC` by default, 50 per page. */
export async function getArchive(params: ArchiveParams): Promise<Archive> {
  const [teachers, learners] = await Promise.all([
    getArchivedTeachers(params),
    getArchivedLearners(params),
  ]);
  return { teachers, learners };
}
