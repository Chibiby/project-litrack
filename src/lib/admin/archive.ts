import "server-only";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { originalTeacherEmail } from "@/lib/teachers/removed-email";
import type { LearnerPurgeCounts } from "@/lib/archive/purge";

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

export type ArchivedTeacherRow = {
  id: string;
  fullName: string;
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
  schoolId: string;
  schoolName: string;
  /** True when the learner's own school has been soft-deleted. */
  schoolDeleted: boolean;
  gradeLevel: string;
  section: string | null;
  isAralLearner: boolean;
  deletedAt: string;
  purgeCounts: LearnerPurgeCounts;
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
};

export type Archive = {
  teachers: ArchivePage<ArchivedTeacherRow>;
  learners: ArchivePage<ArchivedLearnerRow>;
};

function normalizePage(page: number | undefined): number {
  return Number.isFinite(page) && (page as number) > 0 ? Math.floor(page as number) : 1;
}

/** Two independently paginated lists, both `deletedAt DESC`, 50 per page. */
export async function getArchive(params: ArchiveParams): Promise<Archive> {
  const teacherPage = normalizePage(params.teacherPage);
  const learnerPage = normalizePage(params.learnerPage);

  const schoolWhere = params.school ? { schoolId: params.school } : {};
  const nameWhere = params.q ? { fullName: { contains: params.q, mode: "insensitive" as const } } : {};

  const [teacherTotal, teacherRows, learnerTotal, learnerRows] = await Promise.all([
    prisma.user.count({
      where: { role: "TEACHER", deletedAt: { not: null }, ...schoolWhere, ...nameWhere },
    }),
    prisma.user.findMany({
      where: { role: "TEACHER", deletedAt: { not: null }, ...schoolWhere, ...nameWhere },
      select: {
        id: true,
        fullName: true,
        email: true,
        deletedAt: true,
        school: { select: { id: true, name: true, deletedAt: true } },
      },
      orderBy: { deletedAt: "desc" },
      skip: (teacherPage - 1) * ARCHIVE_PAGE_SIZE,
      take: ARCHIVE_PAGE_SIZE,
    }),
    prisma.learner.count({
      where: { deletedAt: { not: null }, ...schoolWhere, ...nameWhere },
    }),
    prisma.learner.findMany({
      where: { deletedAt: { not: null }, ...schoolWhere, ...nameWhere },
      select: {
        id: true,
        fullName: true,
        isAralLearner: true,
        deletedAt: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
        school: { select: { id: true, name: true, deletedAt: true } },
      },
      orderBy: { deletedAt: "desc" },
      skip: (learnerPage - 1) * ARCHIVE_PAGE_SIZE,
      take: ARCHIVE_PAGE_SIZE,
    }),
  ]);

  const teachers = teacherRows.map((t) => ({
    id: t.id,
    fullName: t.fullName,
    schoolId: t.school?.id ?? null,
    schoolName: t.school?.name ?? null,
    schoolDeleted: t.school?.deletedAt != null,
    deletedAt: (t.deletedAt as Date).toISOString(),
    originalEmail: originalTeacherEmail(t.email),
  }));

  // Purge counts for the destructive learner dialog only — the teacher
  // dialog doesn't render them (see `archive-row-actions.tsx`), so nothing
  // is computed for teachers here. One `groupBy` per relation over this
  // page's ids, not a count query per row: 5 queries total instead of
  // `ARCHIVE_PAGE_SIZE * 5`.
  const learnerIds = learnerRows.map((l) => l.id);
  const [enrollmentCounts, attendanceCounts, readingLevelCounts, termGradeCounts, aralProfileCounts] =
    await Promise.all([
      prisma.enrollment.groupBy({
        by: ["learnerId"],
        where: { learnerId: { in: learnerIds } },
        _count: { _all: true },
      }),
      prisma.attendance.groupBy({
        by: ["learnerId"],
        where: { learnerId: { in: learnerIds } },
        _count: { _all: true },
      }),
      prisma.readingLevelRecord.groupBy({
        by: ["learnerId"],
        where: { learnerId: { in: learnerIds } },
        _count: { _all: true },
      }),
      prisma.termGrade.groupBy({
        by: ["learnerId"],
        where: { learnerId: { in: learnerIds } },
        _count: { _all: true },
      }),
      prisma.aralProfile.groupBy({
        by: ["learnerId"],
        where: { learnerId: { in: learnerIds } },
        _count: { _all: true },
      }),
    ]);

  const toCountMap = (rows: { learnerId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.learnerId, r._count._all]));
  const enrollmentByLearner = toCountMap(enrollmentCounts);
  const attendanceByLearner = toCountMap(attendanceCounts);
  const readingLevelByLearner = toCountMap(readingLevelCounts);
  const termGradeByLearner = toCountMap(termGradeCounts);
  const aralProfileByLearner = toCountMap(aralProfileCounts);

  const learners = learnerRows.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    schoolId: l.school.id,
    schoolName: l.school.name,
    schoolDeleted: l.school.deletedAt != null,
    gradeLevel: GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
    section: l.section?.name ?? null,
    isAralLearner: l.isAralLearner,
    deletedAt: (l.deletedAt as Date).toISOString(),
    purgeCounts: {
      enrollment: enrollmentByLearner.get(l.id) ?? 0,
      attendance: attendanceByLearner.get(l.id) ?? 0,
      readingLevelRecord: readingLevelByLearner.get(l.id) ?? 0,
      termGrade: termGradeByLearner.get(l.id) ?? 0,
      aralProfile: aralProfileByLearner.get(l.id) ?? 0,
    } satisfies LearnerPurgeCounts,
  }));

  return {
    teachers: {
      rows: teachers,
      page: teacherPage,
      pages: Math.max(1, Math.ceil(teacherTotal / ARCHIVE_PAGE_SIZE)),
      total: teacherTotal,
    },
    learners: {
      rows: learners,
      page: learnerPage,
      pages: Math.max(1, Math.ceil(learnerTotal / ARCHIVE_PAGE_SIZE)),
      total: learnerTotal,
    },
  };
}
