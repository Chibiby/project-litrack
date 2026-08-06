export const LEARNER_PAGE_SIZE = 20;

export type LearnerListFilter = "all" | "aral" | "archived";
export type LearnerListSort = "name" | "age";

export type LearnerListParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
  filter: LearnerListFilter;
  sort: LearnerListSort;
};

const FILTERS: readonly LearnerListFilter[] = ["all", "aral", "archived"];
const SORTS: readonly LearnerListSort[] = ["name", "age"];

/**
 * Parse teacher grade-page list query params (?page=&q=&filter=&sort=).
 * Pure — no I/O.
 */
export function parseLearnerListParams(
  searchParams: {
    page?: string;
    q?: string;
    filter?: string;
    sort?: string;
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
  const size = pageSize > 0 ? pageSize : LEARNER_PAGE_SIZE;
  const skip = (page - 1) * size;

  return { page, pageSize: size, skip, take: size, q, filter, sort };
}

export function totalPages(totalCount: number, pageSize: number = LEARNER_PAGE_SIZE): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}
