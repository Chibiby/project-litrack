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
export type LearnerListSort = "name" | "age";

/** Roster gender facet. `all` = no filter. */
export type LearnerGenderFilter = "all" | "MALE" | "FEMALE";

/**
 * Roster ARAL facet — whether the learner has a saved `AralProfile` row.
 * Distinct from `LearnerListFilter`'s `aral`, which is the `isAralLearner`
 * designation: a learner can be designated without having been profiled yet.
 */
export type LearnerAralStatusFilter = "all" | "with" | "without";

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
};

const FILTERS: readonly LearnerListFilter[] = ["all", "aral", "archived"];
const SORTS: readonly LearnerListSort[] = ["name", "age"];
const ARAL_STATUSES: readonly LearnerAralStatusFilter[] = [
  "all",
  "with",
  "without",
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
  const sortRaw = (searchParams.sort ?? "name").toLowerCase();
  const sort: LearnerListSort = SORTS.includes(sortRaw as LearnerListSort)
    ? (sortRaw as LearnerListSort)
    : "name";

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
 * Prisma clause for the roster ARAL facet — presence of the `AralProfile`
 * one-to-one relation, not the `isAralLearner` designation.
 */
export function aralStatusWhere(
  status: LearnerAralStatusFilter
):
  | { aralProfile: { isNot: null } }
  | { aralProfile: { is: null } }
  | Record<string, never> {
  if (status === "all") return {};
  return status === "with"
    ? { aralProfile: { isNot: null } }
    : { aralProfile: { is: null } };
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
