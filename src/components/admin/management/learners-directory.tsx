"use client";

import { ChevronRight, GraduationCap } from "lucide-react";
import { useRouter } from "next/navigation";
import { PrefetchLink } from "@/components/nav/prefetch-link";
import { isPlainClick, markPageSlide } from "@/components/ui/page-slide";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Surface } from "@/components/ui/surface";
import { ListNavigationProvider } from "@/components/nav/list-navigation";
import { ListBusyRegion, TableSectionSkeleton } from "@/components/loading";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  CellText,
  NoValue,
  RowActions,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import {
  ListFilterBar,
  describeActiveFilters,
  type ListFilterField,
} from "@/components/admin/management/list-filter-bar";
import { ListPager, PageOutOfRangeState } from "@/components/admin/management/list-pager";
import { GENDER_LABELS } from "@/lib/constants/enum-labels";
import type { LearnerHubRow } from "@/lib/admin/management";

export type LearnersDirectoryList = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  q: string;
};

type LearnersDirectoryProps = {
  rows: LearnerHubRow[];
  list: LearnersDirectoryList;
  basePath: string;
  filters: ListFilterField[];
  /** Drops the School column — a single-school view has nothing to tell apart. */
  hideSchool?: boolean;
  /** List heading; defaults to "Learner directory". */
  heading?: string;
  /** One line under the heading, e.g. what the list counts that the cards do not. */
  headingNote?: string;
  /** Params that survive "Clear filters" (a Super Admin's `schoolId` view context). */
  keepParams?: readonly string[];
  /** Where "Clear filters" in the empty state goes; defaults to `basePath`. */
  clearHref?: string;
  /** Empty-state line when no learner exists at all; the default speaks to the division-wide view. */
  emptyDescription?: string;
  /**
   * Row checkboxes for a host that acts on learners (the School Head page).
   * Absent means a read-only directory, as on the admin page.
   */
  selection?: LearnersDirectorySelection;
  /** Drawn beside the directory heading, e.g. "Transfer selected". */
  bulkActions?: React.ReactNode;
  /** Per-row controls in a trailing Actions column. */
  rowActions?: (row: LearnerHubRow) => React.ReactNode;
  /**
   * The same controls as labelled buttons for a phone row's expanded panel.
   * When given, the phone row shows a chevron instead of `rowActions`.
   */
  rowPanelActions?: (row: LearnerHubRow) => React.ReactNode;
  /** Status shown under the learner's name, e.g. a waiting transfer request. */
  rowBadge?: (row: LearnerHubRow) => React.ReactNode;
  /**
   * Opens each learner's profile at `${rowHrefBase}/${id}`: the whole row is
   * clickable, the name is the keyboard-reachable link, and a trailing chevron
   * shows the row leads somewhere. A string, not a function, so a server page
   * can pass it across the client boundary.
   */
  rowHrefBase?: string;
};

/**
 * Whole-row click for a linked row. Clicks that land on a control inside the
 * row (the name link itself, a checkbox, a row action) are left to that control.
 */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    ? Boolean(target.closest("a, button, input, label, [role='checkbox'], [role='menuitem']"))
    : false;
}

export type LearnersDirectorySelection = {
  selectedIds: ReadonlySet<string>;
  onChange: (next: Set<string>) => void;
};

function SelectAll({ rows, selection }: { rows: LearnerHubRow[]; selection: LearnersDirectorySelection }) {
  const picked = rows.filter((r) => selection.selectedIds.has(r.id)).length;
  const all = rows.length > 0 && picked === rows.length;
  return (
    <Checkbox
      checked={all ? true : picked > 0 ? "indeterminate" : false}
      onCheckedChange={(v) => selection.onChange(v === true ? new Set(rows.map((r) => r.id)) : new Set())}
      aria-label="Select all learners on this page"
    />
  );
}

function SelectOne({ row, selection, where }: { row: LearnerHubRow; selection: LearnersDirectorySelection; where?: string }) {
  return (
    <Checkbox
      checked={selection.selectedIds.has(row.id)}
      onCheckedChange={(v) => {
        const next = new Set(selection.selectedIds);
        if (v === true) next.add(row.id);
        else next.delete(row.id);
        selection.onChange(next);
      }}
      aria-label={`Select ${row.listingName}${where ? ` ${where}` : ""}`}
    />
  );
}

function ProgramBadges({ row }: { row: LearnerHubRow }) {
  if (!row.isAral && !row.isIp) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {row.isAral ? (
        <Badge
          variant="outline"
          className="border-aral-200 bg-aral-50 text-aral-700 dark:border-aral-800 dark:bg-aral-950/30 dark:text-aral-300"
        >
          ARAL
        </Badge>
      ) : null}
      {row.isIp ? (
        <Badge
          variant="outline"
          className="border-warning-200 bg-warning-50 text-warning-800 dark:border-warning-800 dark:bg-warning-950/30 dark:text-warning-300"
        >
          IP
        </Badge>
      ) : null}
    </div>
  );
}

/** Division-wide learner directory: filters, table, pager. One navigation provider for all three. */
export function LearnersDirectory(props: LearnersDirectoryProps) {
  return (
    <ListNavigationProvider>
      <LearnersDirectoryInner {...props} />
    </ListNavigationProvider>
  );
}

function LearnersDirectoryInner({
  rows,
  list,
  basePath,
  filters,
  hideSchool = false,
  heading = "Learner directory",
  headingNote,
  keepParams,
  clearHref,
  emptyDescription = "Learners appear here once a school adds them.",
  selection,
  bulkActions,
  rowActions,
  rowPanelActions,
  rowHrefBase,
  rowBadge,
}: LearnersDirectoryProps) {
  const active = describeActiveFilters(filters, list.q);
  const router = useRouter();
  const hrefFor = (row: LearnerHubRow) =>
    rowHrefBase ? `${rowHrefBase}/${encodeURIComponent(row.id)}` : undefined;

  return (
    <div
      className="space-y-4"
      // Any link to a learner (table name, phone row) slides the profile in.
      onClickCapture={(e) => {
        const a = (e.target as Element).closest?.("a[href]");
        if (rowHrefBase && a?.getAttribute("href")?.startsWith(`${rowHrefBase}/`) && isPlainClick(e)) {
          markPageSlide("forward");
        }
      }}
    >
      <Surface as="section" aria-label="Find learners" className="rounded-lg p-3 sm:p-4">
        <ListFilterBar
          basePath={basePath}
          q={list.q}
          resultCount={list.totalCount}
          searchLabel="Search learners"
          searchPlaceholder="Learner name…"
          fields={filters}
          keepParams={keepParams}
        />
      </Surface>
      <Surface as="section" className="min-w-0 space-y-3 overflow-hidden rounded-lg">
        <div className="flex items-center justify-between gap-3 px-3 pt-4 sm:px-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              {heading}{" "}
              <span className="text-muted-foreground">({list.totalCount.toLocaleString()})</span>
            </h2>
            {headingNote ? <p className="mt-0.5 text-xs text-muted-foreground">{headingNote}</p> : null}
          </div>
          {bulkActions ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {bulkActions}
              <span className="text-xs text-muted-foreground">
                Page {list.page} of {list.totalPages}
              </span>
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              Page {list.page} of {list.totalPages}
            </span>
          )}
        </div>
        <ListBusyRegion
          label="learners"
          skeleton={<TableSectionSkeleton rows={10} columns={hideSchool ? 5 : 6} showToolbar={false} />}
        >
          {rows.length === 0 ? (
            <div className="px-4 pb-4">
              {list.totalCount > 0 ? (
                <PageOutOfRangeState
                  basePath={basePath}
                  page={list.page}
                  totalPages={list.totalPages}
                  totalCount={list.totalCount}
                  noun="learners"
                />
              ) : active.length > 0 ? (
                <EmptyState
                  title="No learners match"
                  description={`Nothing matches ${active.join(" · ")}. ${
                    filters.every((f) => !f.value)
                      ? "Try a different search or clear it."
                      : "Try a wider filter or clear them."
                  }`}
                  actionHref={clearHref ?? basePath}
                  actionLabel="Clear filters"
                  icon={GraduationCap}
                />
              ) : (
                <EmptyState
                  title="No learners yet"
                  description={emptyDescription}
                  icon={GraduationCap}
                />
              )}
            </div>
          ) : (
            <ResponsiveTable
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      {selection ? (
                        <TableHead className="w-10 pl-4">
                          <SelectAll rows={rows} selection={selection} />
                        </TableHead>
                      ) : null}
                      <TableHead className="pl-4">Name</TableHead>
                      <TableHead>Sex</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Section</TableHead>
                      {hideSchool ? null : <TableHead>School</TableHead>}
                      <TableHead className="pr-4">Programs</TableHead>
                      {rowActions || rowHrefBase ? (
                        <TableHead className="pr-4">
                          <span className="sr-only">Actions</span>
                        </TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={selection?.selectedIds.has(row.id) ? "selected" : undefined}
                        className={hrefFor(row) ? "cursor-pointer" : undefined}
                        onClick={
                          hrefFor(row)
                            ? (e) => {
                                if (isInteractiveTarget(e.target)) return;
                                markPageSlide("forward");
                                router.push(hrefFor(row)!);
                              }
                            : undefined
                        }
                      >
                        {selection ? (
                          <TableCell className="w-10 pl-4">
                            <SelectOne row={row} selection={selection} />
                          </TableCell>
                        ) : null}
                        <TableCell className="max-w-72 pl-4 font-medium">
                          {hrefFor(row) ? (
                            <PrefetchLink
                              href={hrefFor(row)!}
                              className="rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <CellText>{row.listingName}</CellText>
                            </PrefetchLink>
                          ) : (
                            <CellText>{row.listingName}</CellText>
                          )}
                          {rowBadge ? rowBadge(row) : null}
                        </TableCell>
                        <TableCell>{GENDER_LABELS[row.gender]}</TableCell>
                        <TableCell className="whitespace-nowrap">{row.gradeLabel}</TableCell>
                        <TableCell className="max-w-40">
                          {row.sectionName ? <CellText>{row.sectionName}</CellText> : <NoValue />}
                        </TableCell>
                        {hideSchool ? null : (
                          <TableCell className="max-w-64 text-muted-foreground">
                            <CellText>{row.school.name}</CellText>
                          </TableCell>
                        )}
                        <TableCell className="pr-4">
                          <ProgramBadges row={row} />
                        </TableCell>
                        {rowActions || rowHrefBase ? (
                          <TableCell className="pr-4">
                            <RowActions>
                              {rowActions ? rowActions(row) : null}
                              {rowHrefBase ? (
                                <ChevronRight
                                  aria-hidden
                                  className="size-4 text-muted-foreground"
                                />
                              ) : null}
                            </RowActions>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
              stacked={
                <StackedList aria-label="Learners">
                  {rows.map((row) => (
                    <StackedRow
                      key={row.id}
                      leading={
                        selection ? (
                          <SelectOne row={row} selection={selection} where="in list" />
                        ) : undefined
                      }
                      title={row.listingName}
                      href={hrefFor(row)}
                      // Grade and section sit under the name, not beside it: a
                      // long section name beside the name cut the name to a
                      // few letters on a phone.
                      state={
                        <span className="font-medium text-foreground">
                          {row.gradeLabel}
                          {row.sectionName ? ` · ${row.sectionName}` : ""}
                        </span>
                      }
                      meta={
                        <>
                          {row.isAral || row.isIp ? <ProgramBadges row={row} /> : null}
                          {rowBadge ? rowBadge(row) : null}
                        </>
                      }
                      details={[
                        { label: "Sex", value: GENDER_LABELS[row.gender] },
                        ...(hideSchool ? [] : [{ label: "School", value: row.school.name }]),
                      ]}
                      actions={
                        !rowPanelActions && rowActions ? (
                          rowActions(row)
                        ) : hrefFor(row) ? (
                          <PrefetchLink
                            href={hrefFor(row)!}
                            aria-label={`Open ${row.listingName}'s profile`}
                            className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <ChevronRight aria-hidden className="size-4" />
                          </PrefetchLink>
                        ) : undefined
                      }
                      detailActions={rowPanelActions ? rowPanelActions(row) : undefined}
                    />
                  ))}
                </StackedList>
              }
            />
          )}
        </ListBusyRegion>
        {list.totalCount > 0 ? (
          <ListPager
            basePath={basePath}
            page={list.page}
            pageSize={list.pageSize}
            totalPages={list.totalPages}
            totalCount={list.totalCount}
            noun="learners"
          />
        ) : null}
      </Surface>
    </div>
  );
}
