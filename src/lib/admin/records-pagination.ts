/**
 * Page sizes for the deleted-records lists (Monitoring → Deleted Records and
 * the district Deleted learners page). Pure, so client and server share it.
 */
export const RECORDS_PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type RecordsPageSize = (typeof RECORDS_PAGE_SIZE_OPTIONS)[number];
export const RECORDS_DEFAULT_PAGE_SIZE: RecordsPageSize = 50;

/** Parse `?perPage=`, falling back to the default on anything unknown. */
export function parseRecordsPageSize(raw: string | undefined): RecordsPageSize {
  const n = Number.parseInt(raw ?? "", 10);
  return (RECORDS_PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? (n as RecordsPageSize)
    : RECORDS_DEFAULT_PAGE_SIZE;
}

/** `?page=` as a positive integer, 1 on anything else. */
export function parseRecordsPage(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Name search where every word must appear somewhere in `fullName`, so
 * "Cruz, Ruby" (the list's own Last, First order) finds "Ruby Cornejo Dela
 * Cruz". Commas are separators. Empty input adds no condition.
 */
export function nameWordsWhere(
  q: string | undefined
): { AND: { fullName: { contains: string; mode: "insensitive" } }[] } | Record<string, never> {
  const words = (q ?? "").split(/[\s,]+/).filter(Boolean).slice(0, 6);
  if (words.length === 0) return {};
  return { AND: words.map((word) => ({ fullName: { contains: word, mode: "insensitive" as const } })) };
}
