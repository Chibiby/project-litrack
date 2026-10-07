/**
 * Paging, search and sorting for the rows of one by-school summary table.
 *
 * Pure and client-safe: no "server-only", no React. The division summary has
 * hundreds of schools, so the page shows `SCHOOL_PAGE_SIZE` at a time; the
 * table's state lives in flat URL search params (`sort.<k>`, `dir.<k>`,
 * `page.<k>`, plus one shared `q`).
 */
import type { SummaryGroup, SummarySection } from "../types";

export const SCHOOL_PAGE_SIZE = 25;

export type SchoolSortDir = "asc" | "desc";

/** `sort` is "name", "total", or a bucket id. */
export type SchoolTableParams = { sort: string; dir: SchoolSortDir; page: number };

const QUERY_MAX = 100;

/** URL-safe key for one table's params: every char outside [a-zA-Z0-9_-] becomes "-". */
export function tableParamKey(sectionId: string): string {
  return sectionId.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function tableParamNames(sectionId: string): { sort: string; dir: string; page: string } {
  const k = tableParamKey(sectionId);
  return { sort: `sort.${k}`, dir: `dir.${k}`, page: `page.${k}` };
}

/** Missing or garbage -> sort "name"; dir defaults to asc for name, desc otherwise; page is a positive integer, else 1. */
export function readSchoolTableParams(
  search: Readonly<Record<string, string | undefined>>,
  sectionId: string,
): SchoolTableParams {
  const names = tableParamNames(sectionId);
  const rawSort = search[names.sort]?.trim();
  const sort = rawSort ? rawSort : "name";
  const rawDir = search[names.dir];
  const dir: SchoolSortDir =
    rawDir === "asc" || rawDir === "desc" ? rawDir : sort === "name" ? "asc" : "desc";
  const rawPage = search[names.page]?.trim() ?? "";
  const parsed = /^\d+$/.test(rawPage) ? Number(rawPage) : 0;
  const page = Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1;
  return { sort, dir, page };
}

/** The shared search text from `q`, trimmed, at most 100 characters; "" when absent. */
export function readSchoolQuery(search: Readonly<Record<string, string | undefined>>): string {
  return (search.q ?? "").trim().slice(0, QUERY_MAX);
}

export type SchoolPage = {
  section: SummarySection;
  /** Schools in the table before the search (blocks, see `pageSchoolSection`). */
  totalSchools: number;
  matchedSchools: number;
  /** The clamped page actually returned. */
  page: number;
  pageCount: number;
  pageSize: number;
};

/** One block per school, in first-appearance order. Groups without a schoolId share a single block. */
function toBlocks(groups: readonly SummaryGroup[]): PageBlock[] {
  const bySchool = new Map<string, SummaryGroup[]>();
  const orphans: SummaryGroup[] = [];
  const order: (string | null)[] = [];
  for (const g of groups) {
    if (g.schoolId === undefined) {
      if (orphans.length === 0) order.push(null);
      orphans.push(g);
      continue;
    }
    const rows = bySchool.get(g.schoolId);
    if (rows) rows.push(g);
    else {
      bySchool.set(g.schoolId, [g]);
      order.push(g.schoolId);
    }
  }
  return order.map((id) => {
    const rows = id === null ? orphans : (bySchool.get(id) as SummaryGroup[]);
    const total = rows.find((r) => r.gradeType == null) ?? rows[rows.length - 1];
    return { id, rows, total };
  });
}

/** A unit of paging: one school's or one district's rows, kept together. `id` null sorts last and is never filtered out. */
export type PageBlock = { id: string | null; rows: SummaryGroup[]; total: SummaryGroup };

const NATURAL = { numeric: true, sensitivity: "base" } as const;

/** District ascending ("Alabel 2" before "Alabel 10"); no district last. Same for both sort directions. */
function compareDistrict(a: PageBlock, b: PageBlock): number {
  const da = a.total.district ?? null;
  const db = b.total.district ?? null;
  if (da === db) return 0;
  if (da === null) return 1;
  if (db === null) return -1;
  return da.localeCompare(db, undefined, NATURAL);
}

function compareName(a: PageBlock, b: PageBlock): number {
  return a.total.label.localeCompare(b.total.label) || (a.id ?? "").localeCompare(b.id ?? "");
}

/**
 * Filter, sort and slice blocks of one section. Shared by the by-school and
 * by-district tables; see `pageSchoolSection` for the sort rules.
 */
export function pageBlocks(
  section: SummarySection,
  blocks: readonly PageBlock[],
  opts: {
    matches: (block: PageBlock) => boolean;
    params: SchoolTableParams;
    pageSize: number;
    /** Name sort groups blocks by district first (by-school tables). */
    districtFirst?: boolean;
  },
): {
  section: SummarySection;
  total: number;
  matched: number;
  page: number;
  pageCount: number;
  pageSize: number;
} {
  const { pageSize } = opts;
  const matched = blocks.filter((b) => b.id === null || opts.matches(b));

  const { sort, dir } = opts.params;
  const sign = dir === "desc" ? -1 : 1;
  const isBucket = section.buckets.some((b) => b.id === sort);
  const value = (b: PageBlock): number | null => {
    if (b.id === null) return null;
    if (sort === "total") return b.total.base;
    if (!isBucket) return null;
    const c = b.total.cells[sort];
    if (!c) return null;
    return section.kind === "average" ? (c.mean ?? null) : c.pct;
  };

  if (sort === "total" || isBucket) {
    matched.sort((a, b) => {
      const va = value(a);
      const vb = value(b);
      if (va === null || vb === null) {
        if (va === vb) return compareName(a, b);
        return va === null ? 1 : -1;
      }
      return (va - vb) * sign || compareName(a, b);
    });
  } else {
    const district = opts.districtFirst ? compareDistrict : () => 0;
    matched.sort((a, b) => district(a, b) || compareName(a, b) * sign);
  }

  const pageCount = Math.max(1, Math.ceil(matched.length / pageSize));
  const page = Math.min(Math.max(1, Math.floor(opts.params.page) || 1), pageCount);
  const slice = matched.slice((page - 1) * pageSize, page * pageSize);

  return {
    section: { ...section, table: { ...section.table, groups: slice.flatMap((b) => b.rows) } },
    total: blocks.length,
    matched: matched.length,
    page,
    pageCount,
    pageSize,
  };
}

/**
 * Search, sort and slice one by-school section. Never mutates `section`.
 *
 * A school is a block: its grade rows then its total row, kept together and in
 * their original order; the total row supplies the label, base and cells that
 * search and sort read. Groups without a `schoolId` (not expected at level
 * "school") form one block that is never filtered out by the search; it has no
 * sort value, so it sorts after real schools and counts as one block.
 *
 * Sort: "name" by district (always ascending, no district last), then by
 * label and schoolId in the chosen direction; "total" by base; a bucket id from
 * `section.buckets` by pct (by mean for kind "average"). Null values are
 * always last whatever the direction; ties break by school name ascending.
 * Any other sort id behaves as "name".
 */
export function pageSchoolSection(
  section: SummarySection,
  opts: {
    query: string;
    params: SchoolTableParams;
    schoolCodes: ReadonlyMap<string, string>;
    pageSize?: number;
  },
): SchoolPage {
  const pageSize = opts.pageSize && opts.pageSize > 0 ? Math.floor(opts.pageSize) : SCHOOL_PAGE_SIZE;
  const blocks = toBlocks(section.table.groups);

  const needle = opts.query.trim().toLowerCase();
  const r = pageBlocks(section, blocks, {
    params: opts.params,
    pageSize,
    districtFirst: true,
    matches: (b) => {
      if (!needle) return true;
      if (b.total.label.toLowerCase().includes(needle)) return true;
      return (opts.schoolCodes.get(b.id as string) ?? "").toLowerCase().includes(needle);
    },
  });

  return {
    section: r.section,
    totalSchools: r.total,
    matchedSchools: r.matched,
    page: r.page,
    pageCount: r.pageCount,
    pageSize: r.pageSize,
  };
}
