"use client";

import { GraduationCap } from "lucide-react";
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
} from "@/components/ui/table";
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
  /** Status shown under the learner's name, e.g. a waiting transfer request. */
  rowBadge?: (row: LearnerHubRow) => React.ReactNode;
};

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
          className="border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300"
        >
          ARAL
        </Badge>
      ) : null}
      {row.isIp ? (
        <Badge
          variant="outline"
          className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300"
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
  keepParams,
  clearHref,
  emptyDescription = "Learners appear here once a school adds them.",
  selection,
  bulkActions,
  rowActions,
  rowBadge,
}: LearnersDirectoryProps) {
  const active = describeActiveFilters(filters, list.q);

  return (
    <div className="space-y-4">
      <Surface as="section" aria-label="Find learners" className="rounded-2xl p-3 sm:p-4">
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
      <Surface as="section" className="min-w-0 space-y-3 overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 px-3 pt-4 sm:px-4">
          <h2 className="text-base font-semibold">
            Learner directory{" "}
            <span className="text-muted-foreground">({list.totalCount.toLocaleString()})</span>
          </h2>
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
            <>
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {selection ? (
                        <TableHead className="w-10 pl-4">
                          <SelectAll rows={rows} selection={selection} />
                        </TableHead>
                      ) : null}
                      <TableHead className="pl-4 text-xs">Name</TableHead>
                      <TableHead className="text-xs">Sex</TableHead>
                      <TableHead className="text-xs">Grade</TableHead>
                      <TableHead className="text-xs">Section</TableHead>
                      {hideSchool ? null : <TableHead className="text-xs">School</TableHead>}
                      <TableHead className="pr-4 text-xs">Programs</TableHead>
                      {rowActions ? <TableHead className="pr-4 text-right text-xs">Actions</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        data-state={selection?.selectedIds.has(row.id) ? "selected" : undefined}
                      >
                        {selection ? (
                          <TableCell className="w-10 py-2.5 pl-4">
                            <SelectOne row={row} selection={selection} />
                          </TableCell>
                        ) : null}
                        <TableCell className="py-2.5 pl-4 text-sm font-medium">
                          {row.listingName}
                          {rowBadge ? rowBadge(row) : null}
                        </TableCell>
                        <TableCell className="py-2.5 text-sm">{GENDER_LABELS[row.gender]}</TableCell>
                        <TableCell className="py-2.5 text-sm">{row.gradeLabel}</TableCell>
                        <TableCell className="py-2.5 text-sm">{row.sectionName ?? "—"}</TableCell>
                        {hideSchool ? null : (
                          <TableCell className="py-2.5 text-sm text-muted-foreground">{row.school.name}</TableCell>
                        )}
                        <TableCell className="py-2.5 pr-4">
                          <ProgramBadges row={row} />
                        </TableCell>
                        {rowActions ? (
                          <TableCell className="py-2.5 pr-4 text-right">{rowActions(row)}</TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="divide-y divide-border/60 lg:hidden" aria-label="Learners">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                    {selection ? (
                      <span className="pt-0.5">
                        <SelectOne row={row} selection={selection} where="in list" />
                      </span>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{row.listingName}</p>
                      {rowBadge ? rowBadge(row) : null}
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {GENDER_LABELS[row.gender]} · {row.gradeLabel}
                        {row.sectionName ? ` · ${row.sectionName}` : ""}
                      </p>
                      {hideSchool ? null : (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.school.name}</p>
                      )}
                    </div>
                    <div className="shrink-0">
                      <ProgramBadges row={row} />
                    </div>
                    {rowActions ? <div className="shrink-0">{rowActions(row)}</div> : null}
                  </li>
                ))}
              </ul>
            </>
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
