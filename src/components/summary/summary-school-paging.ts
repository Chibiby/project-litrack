import {
  tableParamNames,
  type SchoolPage,
  type SchoolTableParams,
} from "@/lib/summary/shape/school-page";
import { summaryHref, withoutPageParams, type FlatSearchParams } from "./summary-href";

/** What a by-school table needs to render one page and link to its neighbours. */
export type SchoolPaging = {
  /** The facet's own path, e.g. `/admin/monitoring/division-summary/learners`. */
  basePath: string;
  searchParams: FlatSearchParams;
  /** The shared search text, already trimmed. */
  query: string;
  params: SchoolTableParams;
  page: SchoolPage;
};

/** Name sorts A-Z first; every figure sorts largest first. */
export function defaultSortDir(sort: string): "asc" | "desc" {
  return sort === "name" ? "asc" : "desc";
}

/**
 * Href for a column header: the first click uses the column's default
 * direction, a click on the active column flips it. The table goes back to
 * page 1.
 */
export function sortHref(paging: SchoolPaging, sectionId: string, column: string): string {
  const names = tableParamNames(sectionId);
  const { sort, dir } = paging.params;
  const nextDir = sort === column ? (dir === "asc" ? "desc" : "asc") : defaultSortDir(column);
  return summaryHref(paging.basePath, paging.searchParams, {
    [names.sort]: column,
    [names.dir]: nextDir,
    [names.page]: null,
  });
}

/** Page 1 drops the param. */
export function pageHref(paging: SchoolPaging, sectionId: string, page: number): string {
  const names = tableParamNames(sectionId);
  return summaryHref(paging.basePath, paging.searchParams, {
    [names.page]: page > 1 ? String(page) : null,
  });
}

/** Same view with the search cleared and every table back on page 1. */
export function clearSearchHref(paging: SchoolPaging): string {
  return summaryHref(paging.basePath, withoutPageParams(paging.searchParams), { q: null });
}
