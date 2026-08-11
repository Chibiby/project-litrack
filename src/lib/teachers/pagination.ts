export const TEACHERS_PAGE_SIZE = 20;

export type TeachersListParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
};

/**
 * Parse school-head teachers list query params (?page=&q=).
 * Pure — no I/O. Applies to the active-teachers bucket.
 */
export function parseTeachersListParams(
  searchParams: { page?: string; q?: string },
  pageSize: number = TEACHERS_PAGE_SIZE
): TeachersListParams {
  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const q = (searchParams.q ?? "").trim();
  const size = pageSize > 0 ? pageSize : TEACHERS_PAGE_SIZE;
  const skip = (page - 1) * size;
  return { page, pageSize: size, skip, take: size, q };
}

export function teachersTotalPages(
  totalCount: number,
  pageSize: number = TEACHERS_PAGE_SIZE
): number {
  if (totalCount <= 0) return 1;
  return Math.ceil(totalCount / pageSize);
}
