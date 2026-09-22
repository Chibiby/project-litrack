import type { Prisma } from "@prisma/client";
import { assertOrderByCoversOptions, defineSort } from "@/lib/sort/registry";

export const LEARNER_PAGE_SIZE = 20;

/**
 * Rows-per-page choices for the teacher roster footer. The roster defaults to
 * 10 so the first screen matches the approved comp; every other list page keeps
 * LEARNER_PAGE_SIZE by not passing a size through.
 */
export const LEARNER_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
export type LearnerPageSize = (typeof LEARNER_PAGE_SIZE_OPTIONS)[number];
export const LEARNER_LIST_DEFAULT_PAGE_SIZE: LearnerPageSize = 10;

/** Parse `?perPage=`, falling back to the roster default on anything unknown. */
export function parseLearnerPageSize(raw: string | undefined): LearnerPageSize {
  const n = Number.parseInt(raw ?? "", 10);
  return (LEARNER_PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? (n as LearnerPageSize)
    : LEARNER_LIST_DEFAULT_PAGE_SIZE;
}

export type LearnerListFilter = "all" | "aral" | "archived";

/**
 * "Sort by" for the teacher learner roster. `name` and `age` are the two
 * legacy values a bookmarked roster URL may already carry — kept as the
 * exact same tokens rather than renamed, so `?sort=name` and `?sort=age`
 * keep resolving. `name` is relabeled "Alphabetical" here: the table always
 * displayed name-sorted, and the owner has decided Alphabetical is the
 * roster's default, so the existing default value and the new default
 * requirement are the same option.
 *
 * Alphabetical orders by `lastName` then `firstName` — the roster's
 * `formatListingNameFromRecord` column reads surname-first, and ordering by
 * the denormalized `fullName` (Firstname-first) would sort against what the
 * column shows and land page boundaries mid-alphabet.
 */
export const LEARNER_LIST_SORTS = defineSort(
  [
    { value: "name", label: "Alphabetical" },
    { value: "age", label: "Age (youngest first)" },
    { value: "grade", label: "Grade level" },
    { value: "section", label: "Section" },
    { value: "date-added", label: "Date added (newest)" },
    { value: "reading-level", label: "Filipino reading level" },
    { value: "aral-status", label: "ARAL status" },
  ] as const,
  "name"
);

export type LearnerListSort = (typeof LEARNER_LIST_SORTS.options)[number]["value"];

/**
 * The primary `orderBy` clause per sort option, without the tiebreaker.
 * Kept alongside `LEARNER_LIST_SORTS` so an option added to one and not the
 * other is a build-time (`satisfies`) and test-time
 * (`assertOrderByCoversOptions`) failure rather than a silently unsorted
 * table. Mirrors `TEACHER_SORT_ORDER_BY` in `src/lib/teachers/pagination.ts`.
 */
const LEARNER_SORT_ORDER_BY = {
  name: [{ lastName: "asc" }, { firstName: "asc" }],
  age: [{ age: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
  grade: [{ gradeLevel: { type: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
  section: [{ section: { name: "asc" } }, { lastName: "asc" }, { firstName: "asc" }],
  "date-added": [{ createdAt: "desc" }],
  // `ReadingProfile`'s declaration order in `prisma/schema.prisma` IS the
  // rubric order (lowest to highest reading level) — this is an intentional
  // free win from Postgres enum ordinal ordering, not alphabetical. Do not
  // "fix" this to a labeled sort; the rubric order is what a teacher scanning
  // for struggling readers wants, and alphabetical would scramble it.
  "reading-level": [
    { filipinoReadingProfile: "asc" },
    { lastName: "asc" },
    { firstName: "asc" },
  ],
  // Enrolled-in-ARAL first: `desc` puts `true` ahead of `false`.
  "aral-status": [{ isAralLearner: "desc" }, { lastName: "asc" }, { firstName: "asc" }],
} satisfies Record<LearnerListSort, Prisma.LearnerOrderByWithRelationInput[]>;

assertOrderByCoversOptions(LEARNER_LIST_SORTS, LEARNER_SORT_ORDER_BY);

/**
 * Prisma `orderBy` array for a parsed learner list sort, always ending in
 * the `id` tiebreaker. This roster is server-paginated with skip/take, and
 * every option here (grade, section, reading level, ARAL status) is
 * low-cardinality — without the tiebreaker Postgres can repeat or skip a
 * learner across pages.
 */
export function learnerListOrderBy(
  sort: LearnerListSort
): Prisma.LearnerOrderByWithRelationInput[] {
  return [...LEARNER_SORT_ORDER_BY[sort], { id: "asc" }];
}

/** Roster gender facet. `all` = no filter. */
export type LearnerGenderFilter = "all" | "MALE" | "FEMALE";

/**
 * Roster ARAL facet — whether the learner is enrolled in ARAL (`isAralLearner`).
 *
 * This used to filter on the presence of a saved `AralProfile` row instead, which
 * answered a different question: a learner is enrolled the moment a teacher
 * enrols them, and profiled only once somebody fills in Sections B–E. The roster
 * still shows profiling in its own column ("ARAL Profile"); enrolment is what the
 * facet narrows by, because that is what the Enroll as ARAL action changes.
 */
export type LearnerAralStatusFilter = "all" | "enrolled" | "not-enrolled";

/** `all` = no filter; `none` = unassigned; otherwise a section id. */
export type LearnerListSectionFilter = "all" | "none" | (string & {});

/**
 * `all` = every assigned grade; `floating` = the per-school FLOATING grade
 * (learners with no real grade/section yet); otherwise a grade level id.
 */
export type LearnerListGradeFilter = "all" | "floating" | (string & {});

export type LearnerListParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
  filter: LearnerListFilter;
  sort: LearnerListSort;
  section: LearnerListSectionFilter;
  grade: LearnerListGradeFilter;
  gender: LearnerGenderFilter;
  aralStatus: LearnerAralStatusFilter;
  /** A section id the teacher advises; `null` = all advisories. Validated by the page. */
  advisory: string | null;
};

const FILTERS: readonly LearnerListFilter[] = ["all", "aral", "archived"];
const ARAL_STATUSES: readonly LearnerAralStatusFilter[] = [
  "all",
  "enrolled",
  "not-enrolled",
];

/**
 * Parse teacher grade-page list query params (?page=&q=&filter=&sort=&section=&grade=).
 * Pure — no I/O.
 *
 * `section`: omitted/empty/"all" → all; "none" → unassigned; else section id.
 * `grade`: omitted/empty/"all" → all; "floating" → the FLOATING grade; else grade level id.
 */
export function parseLearnerListParams(
  searchParams: {
    page?: string;
    q?: string;
    filter?: string;
    sort?: string;
    section?: string;
    grade?: string;
    gender?: string;
    aralStatus?: string;
    advisory?: string;
  },
  pageSize: number = LEARNER_PAGE_SIZE
): LearnerListParams {
  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const q = (searchParams.q ?? "").trim();
  const filterRaw = (searchParams.filter ?? "all").toLowerCase();
  const filter: LearnerListFilter = FILTERS.includes(filterRaw as LearnerListFilter)
    ? (filterRaw as LearnerListFilter)
    : "all";
  const sort: LearnerListSort = LEARNER_LIST_SORTS.parse(searchParams.sort);

  const sectionRaw = (searchParams.section ?? "").trim();
  const sectionLower = sectionRaw.toLowerCase();
  let section: LearnerListSectionFilter = "all";
  if (sectionRaw && sectionLower !== "all") {
    section = sectionLower === "none" ? "none" : sectionRaw;
  }

  const gradeRaw = (searchParams.grade ?? "").trim();
  const gradeLower = gradeRaw.toLowerCase();
  let grade: LearnerListGradeFilter = "all";
  if (gradeRaw && gradeLower !== "all") {
    grade = gradeLower === "floating" ? "floating" : gradeRaw;
  }

  // Uppercased to match the Prisma enum, so "all" can never round-trip through
  // GENDERS — compare the two real values directly instead.
  const genderRaw = (searchParams.gender ?? "").trim().toUpperCase();
  const gender: LearnerGenderFilter =
    genderRaw === "MALE" || genderRaw === "FEMALE" ? genderRaw : "all";

  const aralStatusRaw = (searchParams.aralStatus ?? "all").trim().toLowerCase();
  const aralStatus: LearnerAralStatusFilter = ARAL_STATUSES.includes(
    aralStatusRaw as LearnerAralStatusFilter
  )
    ? (aralStatusRaw as LearnerAralStatusFilter)
    : "all";

  const advisoryRaw = (searchParams.advisory ?? "").trim();
  const advisory = advisoryRaw && advisoryRaw.toLowerCase() !== "all" ? advisoryRaw : null;

  const size = pageSize > 0 ? pageSize : LEARNER_PAGE_SIZE;
  const skip = (page - 1) * size;

  return {
    page,
    pageSize: size,
    skip,
    take: size,
    q,
    filter,
    sort,
    section,
    grade,
    gender,
    aralStatus,
    advisory,
  };
}

/** Prisma `sectionId` clause for a parsed list section filter. */
export function sectionIdWhere(
  section: LearnerListSectionFilter
): { sectionId: null } | { sectionId: string } | Record<string, never> {
  if (section === "all") return {};
  if (section === "none") return { sectionId: null };
  return { sectionId: section };
}

/** Prisma `gender` clause for the roster gender facet. */
export function genderWhere(
  gender: LearnerGenderFilter
): { gender: "MALE" | "FEMALE" } | Record<string, never> {
  if (gender === "all") return {};
  return { gender };
}

/**
 * Prisma clause for the roster ARAL facet — the `isAralLearner` enrolment flag.
 *
 * Not the `AralProfile` relation: profiling has its own column, and a teacher who
 * filters "Not enrolled" is looking for learners to enrol, not learners nobody has
 * profiled yet.
 */
export function aralStatusWhere(
  status: LearnerAralStatusFilter
): { isAralLearner: boolean } | Record<string, never> {
  if (status === "all") return {};
  return { isAralLearner: status === "enrolled" };
}

/**
 * Prisma `gradeLevelId` clause for assigned grades + optional grade filter.
 * Unknown grade ids fall back to all assigned grades.
 *
 * `"floating"` selects the FLOATING grade by relation (its id is per-school and
 * not known here), still intersected with `assignedGradeIds` so the clause can
 * never widen past what the caller is allowed to see.
 */
export function gradeLevelIdWhere(
  grade: LearnerListGradeFilter,
  assignedGradeIds: string[]
):
  | { gradeLevelId: string }
  | { gradeLevelId: { in: string[] } }
  | { gradeLevelId: { in: string[] }; gradeLevel: { type: "FLOATING" } } {
  if (grade === "floating") {
    return {
      gradeLevelId: { in: assignedGradeIds },
      gradeLevel: { type: "FLOATING" },
    };
  }
  if (grade !== "all" && assignedGradeIds.includes(grade)) {
    return { gradeLevelId: grade };
  }
  return { gradeLevelId: { in: assignedGradeIds } };
}

/** Prisma `fullName` contains clause for roster search (`q`). */
export function nameSearchWhere(
  q: string
): { fullName: { contains: string; mode: "insensitive" } } | Record<string, never> {
  const trimmed = q.trim();
  if (!trimmed) return {};
  return { fullName: { contains: trimmed, mode: "insensitive" } };
}

export function totalPages(totalCount: number, pageSize: number = LEARNER_PAGE_SIZE): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}
