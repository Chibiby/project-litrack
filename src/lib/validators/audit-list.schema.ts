import { z } from "zod";

/**
 * Local calendar day, `YYYY-MM-DD` — the same wire format the attendance grid
 * and report hub use (`src/lib/date-keys.ts`). Never accept an ISO instant
 * here: `toISOString()` on a picked day shifts the calendar date at UTC+8.
 */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

export const AUDIT_SEARCH_MAX_LENGTH = 100;

const qSchema = z.string().trim().max(AUDIT_SEARCH_MAX_LENGTH);

export type AuditListParams = {
  q: string;
  from: string | null;
  to: string | null;
  page: number;
};

/**
 * Parse `?q=&from=&to=&page=` for the audit tables (School Head and, later,
 * Super Admin).
 *
 * Never throws and never widens the caller's query: an oversized search term,
 * a malformed date, or a `to` that lands before `from` each degrade that one
 * field back to its default rather than failing the page or falling through
 * to an unfiltered scan. Tenancy is applied separately by the caller — this
 * only shapes the free-text and date-range facets.
 */
export function parseAuditListParams(searchParams: {
  q?: string;
  from?: string;
  to?: string;
  page?: string;
}): AuditListParams {
  const qParsed = qSchema.safeParse(searchParams.q ?? "");
  const q = qParsed.success ? qParsed.data : "";

  const fromParsed = searchParams.from
    ? dateKey.safeParse(searchParams.from)
    : null;
  const toParsed = searchParams.to ? dateKey.safeParse(searchParams.to) : null;
  const from = fromParsed?.success ? fromParsed.data : null;
  // A malformed `to`, or one that lands before `from`, is dropped rather than
  // guessed at — the range degrades to open-ended instead of a 500 or a
  // silently swapped pair.
  const to =
    toParsed?.success && (!from || toParsed.data >= from) ? toParsed.data : null;

  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;

  return { q, from, to, page };
}
