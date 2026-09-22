import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolsList } from "@/lib/cache/tags";
import { assertOrderByCoversOptions, defineSort } from "@/lib/sort/registry";
import type { SchoolRow } from "@/components/schools-table";

export const SCHOOLS_PAGE_SIZE = 10;

/**
 * "Sort by" for the Super Admin schools console.
 *
 * DEFAULT is `alphabetical` (school name), not the previous `createdAt desc`
 * default — this list is named by SCHOOL name, and the project convention is
 * that a name-bearing list defaults to alphabetical order. This is a
 * deliberate behaviour change from the prior unconditional `{ createdAt: "desc" }`.
 *
 * There is no `teachers` option: `School.users` (the `Users` column on this
 * table) holds SCHOOL_HEAD and TEACHER rows together, and Prisma's relation
 * `orderBy` aggregate (`UserOrderByRelationAggregateInput`) exposes only an
 * unfiltered `_count` — there is no `where` to isolate TEACHER rows when
 * ordering. Sorting by that unfiltered count and labelling it "Teachers"
 * would silently misreport School Head-heavy schools as teacher-heavy, so
 * this exposes `users` (most), matching the column actually rendered,
 * instead of faking a teachers-only sort.
 */
export const SCHOOLS_LIST_SORTS = defineSort(
  [
    { value: "alphabetical", label: "Alphabetical (school name)" },
    { value: "date-added", label: "Date added (newest)" },
    { value: "region", label: "Region" },
    { value: "division", label: "Division" },
    { value: "learners", label: "Learners (most)" },
    { value: "users", label: "Users (most)" },
    { value: "status", label: "Status" },
  ] as const,
  "alphabetical"
);

export type SchoolsListSort = (typeof SCHOOLS_LIST_SORTS.options)[number]["value"];

/**
 * The primary `orderBy` clause per sort option, without the tiebreaker. Kept
 * alongside `SCHOOLS_LIST_SORTS` so an option added to one and not the other
 * is a build-time (`satisfies`) and test-time (`assertOrderByCoversOptions`)
 * failure rather than a silently unsorted table.
 */
const SCHOOLS_LIST_SORT_ORDER_BY = {
  alphabetical: [{ name: "asc" }],
  "date-added": [{ createdAt: "desc" }],
  region: [{ region: "asc" }],
  division: [{ division: "asc" }],
  learners: [{ learners: { _count: "desc" } }],
  users: [{ users: { _count: "desc" } }],
  status: [{ isActive: "desc" }],
} satisfies Record<SchoolsListSort, Prisma.SchoolOrderByWithRelationInput[]>;

assertOrderByCoversOptions(SCHOOLS_LIST_SORTS, SCHOOLS_LIST_SORT_ORDER_BY);

/**
 * Prisma `orderBy` array for a parsed schools list sort, always ending in the
 * `id` tiebreaker. This list is server-paginated with skip/take — `region`,
 * `division`, `status` and the relation counts are not unique keys, so
 * without the tiebreaker Postgres can repeat or skip a row across pages.
 */
export function schoolsListOrderBy(
  sort: SchoolsListSort
): Prisma.SchoolOrderByWithRelationInput[] {
  return [...SCHOOLS_LIST_SORT_ORDER_BY[sort], { id: "asc" }];
}

export type SchoolsListParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
  region: string;
  status: "" | "active" | "inactive";
  sort: SchoolsListSort;
};

export type SchoolsListPage = {
  rows: SchoolRow[];
  totalCount: number;
};

/**
 * Parse admin schools table query params (?page=&q=&region=&status=&sort=).
 * Pure — no I/O.
 */
export function parseSchoolsListParams(
  searchParams: { page?: string; q?: string; region?: string; status?: string; sort?: string },
  pageSize: number = SCHOOLS_PAGE_SIZE
): SchoolsListParams {
  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const q = (searchParams.q ?? "").trim();
  const region = (searchParams.region ?? "").trim();
  const rawStatus = (searchParams.status ?? "").trim().toLowerCase();
  const status: SchoolsListParams["status"] =
    rawStatus === "active" || rawStatus === "inactive" ? rawStatus : "";
  const sort = SCHOOLS_LIST_SORTS.parse(searchParams.sort);
  const size = pageSize > 0 ? pageSize : SCHOOLS_PAGE_SIZE;
  const skip = (page - 1) * size;
  return { page, pageSize: size, skip, take: size, q, region, status, sort };
}

export function schoolsTotalPages(
  totalCount: number,
  pageSize: number = SCHOOLS_PAGE_SIZE
): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}

function schoolsWhere(
  params: Pick<SchoolsListParams, "q" | "region" | "status">
): Prisma.SchoolWhereInput {
  const where: Prisma.SchoolWhereInput = { deletedAt: null };
  if (params.region) {
    where.region = params.region;
  }
  if (params.status) {
    where.isActive = params.status === "active";
  }
  if (params.q) {
    where.OR = [
      { name: { contains: params.q, mode: "insensitive" } },
      { schoolIdCode: { contains: params.q, mode: "insensitive" } },
      { division: { contains: params.q, mode: "insensitive" } },
      { region: { contains: params.q, mode: "insensitive" } },
    ];
  }
  return where;
}

/**
 * Admin schools table page — Data Cache keyed by `schools-list` + page/q/region.
 */
export function getSchoolsListPage(
  params: SchoolsListParams
): Promise<SchoolsListPage> {
  const { skip, take, q, region, status, page, pageSize, sort } = params;
  return cachedQuery(
    async () => {
      const where = schoolsWhere({ q, region, status });
      const [schools, totalCount] = await Promise.all([
        prisma.school.findMany({
          where,
          orderBy: schoolsListOrderBy(sort),
          skip,
          take,
          select: {
            id: true,
            name: true,
            schoolIdCode: true,
            region: true,
            division: true,
            isActive: true,
            isDemo: true,
            _count: { select: { users: true, learners: true } },
          },
        }),
        prisma.school.count({ where }),
      ]);
      return {
        totalCount,
        rows: schools.map((s) => ({
          ...s,
          users: s._count.users,
          learners: s._count.learners,
        })),
      };
    },
    {
      keyParts: [
        "schools-list",
        `p:${page}`,
        `ps:${pageSize}`,
        `q:${q}`,
        `r:${region}`,
        `s:${status}`,
        // Cache-poisoning guard: two sorts differing only by `sort` must not
        // collide on the same Data Cache entry, or one order serves the
        // other's page until the TTL expires. See cache-schools-list.test.ts.
        `sort:${sort}`,
      ],
      tags: [schoolsList],
      profile: "reference",
    }
  );
}
