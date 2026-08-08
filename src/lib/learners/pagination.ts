export const LEARNER_PAGE_SIZE = 20;

export type LearnerListFilter = "all" | "aral" | "archived";
export type LearnerListSort = "name" | "age";

/** `all` = no filter; `none` = unassigned; otherwise a section id. */
export type LearnerListSectionFilter = "all" | "none" | (string & {});

export type LearnerListParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
  filter: LearnerListFilter;
  sort: LearnerListSort;
  section: LearnerListSectionFilter;
};

const FILTERS: readonly LearnerListFilter[] = ["all", "aral", "archived"];
const SORTS: readonly LearnerListSort[] = ["name", "age"];

/**
 * Parse teacher grade-page list query params (?page=&q=&filter=&sort=&section=).
 * Pure — no I/O.
 *
 * `section`: omitted/empty/"all" → all; "none" → unassigned; else section id.
 */
export function parseLearnerListParams(
  searchParams: {
    page?: string;
    q?: string;
    filter?: string;
    sort?: string;
    section?: string;
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

  const size = pageSize > 0 ? pageSize : LEARNER_PAGE_SIZE;
  const skip = (page - 1) * size;

  return { page, pageSize: size, skip, take: size, q, filter, sort, section };
}

/** Prisma `sectionId` clause for a parsed list section filter. */
export function sectionIdWhere(
  section: LearnerListSectionFilter
): { sectionId: null } | { sectionId: string } | Record<string, never> {
  if (section === "all") return {};
  if (section === "none") return { sectionId: null };
  return { sectionId: section };
}

export function totalPages(totalCount: number, pageSize: number = LEARNER_PAGE_SIZE): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}
