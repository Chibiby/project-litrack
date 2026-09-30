import type { Prisma } from "@prisma/client";
import { assertOrderByCoversOptions, defineSort } from "@/lib/sort/registry";

export const TEACHERS_PAGE_SIZE = 20;

export const TEACHER_LIST_FILTERS = [
  "all",
  "non-deped-aral-volunteer",
  "teacher",
  "floating",
  "multi-advisory",
  "with-advisory",
] as const;

export type TeacherListFilter = (typeof TEACHER_LIST_FILTERS)[number];

/**
 * "Sort by" for the School Head teachers list. Alphabetical is the default —
 * this is a name-bearing list, and surname-first order (`lastName` then
 * `firstName`) is what the table displays via `formatListingNameFromRecord`,
 * never the denormalized `fullName`.
 */
export const TEACHER_LIST_SORTS = defineSort(
  [
    { value: "alphabetical", label: "Alphabetical" },
    { value: "date-added", label: "Date added (newest)" },
    { value: "advisory-mode", label: "Advisory mode" },
  ] as const,
  "alphabetical"
);

export type TeacherListSort = (typeof TEACHER_LIST_SORTS.options)[number]["value"];

/**
 * The primary `orderBy` clause per sort option, without the tiebreaker.
 * Kept alongside `TEACHER_LIST_SORTS` so an option added to one and not the
 * other is a build-time (`satisfies`) and test-time (`assertOrderByCoversOptions`)
 * failure rather than a silently unsorted table.
 */
const TEACHER_SORT_ORDER_BY = {
  alphabetical: [{ lastName: "asc" }, { firstName: "asc" }],
  "date-added": [{ createdAt: "desc" }],
  "advisory-mode": [{ teacherProfile: { advisoryMode: "asc" } }],
} satisfies Record<TeacherListSort, Prisma.UserOrderByWithRelationInput[]>;

assertOrderByCoversOptions(TEACHER_LIST_SORTS, TEACHER_SORT_ORDER_BY);

/**
 * Prisma `orderBy` array for a parsed teacher list sort, always ending in the
 * `id` tiebreaker. Every option here is server-paginated with skip/take —
 * `advisory-mode` and `date-added` are not unique keys, so without the
 * tiebreaker Postgres can repeat or skip a row across pages.
 */
export function teacherListOrderBy(
  sort: TeacherListSort
): Prisma.UserOrderByWithRelationInput[] {
  return [...TEACHER_SORT_ORDER_BY[sort], { id: "asc" }];
}

export type TeachersListParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
  filter: TeacherListFilter;
  sort: TeacherListSort;
  /** Raw, unvalidated GradeLevel id ("" when absent) — see `resolveAdvisoryFacet`. */
  grade: string;
  /** Raw, unvalidated Section id ("" when absent) — see `resolveAdvisoryFacet`. */
  section: string;
};

const MAX_FACET_ID_LENGTH = 64;

function parseFacetId(raw: string | undefined): string {
  const value = (raw ?? "").trim();
  return value.length > MAX_FACET_ID_LENGTH ? "" : value;
}

export type AdvisoryFacet = { gradeId: string | null; sectionId: string | null };

/**
 * Checks the raw `grade`/`section` params against the school's own grades, so an
 * id from another school (or a stale link) is ignored rather than trusted.
 * `grades` must already be scoped to the viewer's school. A section only counts
 * when a valid grade is chosen and the section belongs to that grade.
 */
export function resolveAdvisoryFacet(
  grades: readonly { id: string; sections: readonly { id: string }[] }[],
  grade: string,
  section: string
): AdvisoryFacet {
  const match = grade ? grades.find((g) => g.id === grade) : undefined;
  if (!match) return { gradeId: null, sectionId: null };
  const sectionId =
    section && match.sections.some((s) => s.id === section) ? section : null;
  return { gradeId: match.id, sectionId };
}

/**
 * Advisory grade/section facet as a `where` fragment, or `null` when no facet
 * applies. Scoped by `schoolId` in the query itself as well, so tenancy does not
 * depend on the caller having validated the ids.
 */
export function teacherAdvisoryFacetWhere(
  schoolId: string,
  facet: AdvisoryFacet
): Prisma.UserWhereInput | null {
  if (!facet.gradeId) return null;
  return {
    advisorySections: {
      some: {
        schoolId,
        deletedAt: null,
        gradeLevelId: facet.gradeId,
        gradeLevel: { schoolId, deletedAt: null },
        ...(facet.sectionId ? { id: facet.sectionId } : {}),
      },
    },
  };
}

/**
 * Parse school-head teachers list query params
 * (?page=&q=&filter=&sort=&grade=&section=).
 * Pure — no I/O. Applies to the active-teachers bucket.
 */
export function parseTeachersListParams(
  searchParams: {
    page?: string;
    q?: string;
    filter?: string;
    sort?: string;
    grade?: string;
    section?: string;
  },
  pageSize: number = TEACHERS_PAGE_SIZE
): TeachersListParams {
  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const q = (searchParams.q ?? "").trim();
  const filter = TEACHER_LIST_FILTERS.includes(
    searchParams.filter as TeacherListFilter
  )
    ? (searchParams.filter as TeacherListFilter)
    : "all";
  const sort = TEACHER_LIST_SORTS.parse(searchParams.sort);
  const size = pageSize > 0 ? pageSize : TEACHERS_PAGE_SIZE;
  const skip = (page - 1) * size;
  const grade = parseFacetId(searchParams.grade);
  const section = grade ? parseFacetId(searchParams.section) : "";
  return { page, pageSize: size, skip, take: size, q, filter, sort, grade, section };
}

export function teachersTotalPages(
  totalCount: number,
  pageSize: number = TEACHERS_PAGE_SIZE
): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}
