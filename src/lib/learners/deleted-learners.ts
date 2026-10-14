import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { formatListingNameFromRecord } from "@/lib/names";
import { schoolWhereForScope, type AdminScope } from "@/lib/auth/admin-scope";
import { removalExpiresAt, removalExpiryCutoff } from "@/lib/learners/removal";

/**
 * The read model behind `/admin/deleted-learners` and `/district/deleted-learners`:
 * learners whose 30-day removal window ran out (`deletedAt` set), inside the
 * caller's `AdminScope`.
 *
 * The scope is part of the WHERE (`school: schoolWhereForScope(scope)`), the
 * same way `schoolId: user.schoolId` is everywhere else, so an out-of-scope row
 * is never read into memory. A requested `schoolId` only narrows further: it is
 * ANDed with the scope, never replaces it.
 *
 * Deliberately uncached, for the reason `src/lib/admin/archive.ts` gives: this
 * is the page read immediately before restoring, and a stale row would be
 * misread as the result of the restore just performed.
 */

export const DELETED_LEARNERS_PAGE_SIZE = 50;

export const DELETED_LEARNER_SORTS = ["recent", "alphabetical", "school"] as const;
export type DeletedLearnerSort = (typeof DELETED_LEARNER_SORTS)[number];

export type DeletedLearnerRow = {
  id: string;
  /** Surname-first display form. */
  name: string;
  gradeLabel: string;
  sectionName: string | null;
  schoolId: string;
  schoolName: string;
  district: string | null;
  /** When the teacher removed the learner (ISO), null for legacy rows. */
  removedAt: string | null;
  /** When the learner was soft-deleted (ISO). */
  deletedAt: string;
};

export type DeletedLearnersPage = {
  rows: DeletedLearnerRow[];
  page: number;
  pages: number;
  total: number;
  /** In-scope schools, for the school filter. */
  schools: { id: string; name: string; district: string | null }[];
};

export type DeletedLearnersParams = {
  scope: AdminScope;
  schoolId?: string;
  q?: string;
  page?: number;
  sort?: string;
};

function normalizePage(page: number | undefined): number {
  return Number.isFinite(page) && (page as number) > 0 ? Math.floor(page as number) : 1;
}

function parseSort(sort: string | undefined): DeletedLearnerSort {
  return (DELETED_LEARNER_SORTS as readonly string[]).includes(sort ?? "")
    ? (sort as DeletedLearnerSort)
    : "recent";
}

const ORDER_BY = {
  recent: [{ deletedAt: "desc" }],
  alphabetical: [{ lastName: "asc" }, { firstName: "asc" }],
  school: [{ school: { name: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
} satisfies Record<DeletedLearnerSort, Prisma.LearnerOrderByWithRelationInput[]>;

/**
 * Soft-deleted, or removal expired but the nightly job has not soft-deleted it
 * yet. The teacher side stops at expiry, so without the second branch a learner
 * would be invisible to everyone for up to a day. A removal still inside its 30
 * days belongs to the teacher and matches neither branch. Always ANDed with the
 * scope by the caller, so it cannot widen it.
 */
export function deletedOrExpiredFilter(now: Date = new Date()): Prisma.LearnerWhereInput[] {
  const cutoff = removalExpiryCutoff(now);
  return [
    { deletedAt: { not: null } },
    ...(cutoff ? [{ deletedAt: null, archivedAt: { not: null, lt: cutoff } }] : []),
  ];
}

/** The WHERE, exported so tests can pin that the scope is in it. */
export function deletedLearnersWhere(
  params: Pick<DeletedLearnersParams, "scope" | "schoolId" | "q">
): Prisma.LearnerWhereInput {
  return {
    OR: deletedOrExpiredFilter(),
    school: { AND: [schoolWhereForScope(params.scope), { deletedAt: null }] },
    ...(params.schoolId ? { schoolId: params.schoolId } : {}),
    ...(params.q ? { fullName: { contains: params.q, mode: "insensitive" as const } } : {}),
  };
}

export async function getDeletedLearners(params: DeletedLearnersParams): Promise<DeletedLearnersPage> {
  const page = normalizePage(params.page);
  const sort = parseSort(params.sort);
  const where = deletedLearnersWhere(params);

  const [total, rows, schools] = await Promise.all([
    prisma.learner.count({ where }),
    prisma.learner.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        middleName: true,
        lastName: true,
        archivedAt: true,
        deletedAt: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
        school: { select: { id: true, name: true, district: true } },
      },
      // `id` tiebreaker: skip/take pages repeat or skip rows on ties otherwise.
      orderBy: [...ORDER_BY[sort], { id: "asc" }],
      skip: (page - 1) * DELETED_LEARNERS_PAGE_SIZE,
      take: DELETED_LEARNERS_PAGE_SIZE,
    }),
    prisma.school.findMany({
      where: schoolWhereForScope(params.scope),
      select: { id: true, name: true, district: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return {
    rows: rows.map((l) => ({
      id: l.id,
      name: formatListingNameFromRecord(l),
      gradeLabel: GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
      sectionName: l.section?.name ?? null,
      schoolId: l.school.id,
      schoolName: l.school.name,
      district: l.school.district,
      removedAt: l.archivedAt ? l.archivedAt.toISOString() : null,
      // Not yet soft-deleted (expired, awaiting the nightly job): show when it expires.
      deletedAt: (l.deletedAt ?? removalExpiresAt(l.archivedAt as Date)).toISOString(),
    })),
    page,
    pages: Math.max(1, Math.ceil(total / DELETED_LEARNERS_PAGE_SIZE)),
    total,
    schools,
  };
}
