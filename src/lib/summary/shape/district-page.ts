/**
 * Paging, search and sorting for the rows of one by-district summary table.
 *
 * Same URL scheme as the by-school tables (`sort.<k>`, `dir.<k>`, `page.<k>`,
 * shared `q`; see `school-page.ts`). A district is a block: its total row and
 * its grade rows stay together, so a district is never split across pages.
 */
import type { SummaryGroup, SummarySection } from "../types";
import { pageBlocks, type PageBlock, type SchoolTableParams } from "./school-page";

export const DISTRICT_PAGE_SIZE = 5;

export type DistrictPage = {
  section: SummarySection;
  /** Districts in the table before the search. */
  totalDistricts: number;
  matchedDistricts: number;
  /** The clamped page actually returned. */
  page: number;
  pageCount: number;
  pageSize: number;
};

/** The group key without its `|<gradeType>` suffix: `district:<name>`. */
function districtKeyOf(group: SummaryGroup): string {
  if (group.gradeType == null) return group.key;
  const suffix = `|${group.gradeType}`;
  return group.key.endsWith(suffix) ? group.key.slice(0, -suffix.length) : group.key;
}

function toBlocks(groups: readonly SummaryGroup[]): PageBlock[] {
  const byKey = new Map<string, SummaryGroup[]>();
  for (const g of groups) {
    const key = districtKeyOf(g);
    const rows = byKey.get(key);
    if (rows) rows.push(g);
    else byKey.set(key, [g]);
  }
  return [...byKey.entries()].map(([id, rows]) => ({
    id,
    rows,
    total: rows.find((r) => r.gradeType == null) ?? rows[rows.length - 1]!,
  }));
}

/**
 * Search (district name), sort and slice one by-district section. Never
 * mutates `section`. Sort rules are those of `pageSchoolSection`, read from
 * the district's total row; each district keeps its grade rows in their
 * original order.
 */
export function pageDistrictSection(
  section: SummarySection,
  opts: { query: string; params: SchoolTableParams; pageSize?: number },
): DistrictPage {
  const pageSize = opts.pageSize && opts.pageSize > 0 ? Math.floor(opts.pageSize) : DISTRICT_PAGE_SIZE;
  const needle = opts.query.trim().toLowerCase();
  const r = pageBlocks(section, toBlocks(section.table.groups), {
    params: opts.params,
    pageSize,
    matches: (b) => !needle || b.total.label.toLowerCase().includes(needle),
  });
  return {
    section: r.section,
    totalDistricts: r.total,
    matchedDistricts: r.matched,
    page: r.page,
    pageCount: r.pageCount,
    pageSize: r.pageSize,
  };
}
