"use client";

import { HandHelping } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Surface } from "@/components/ui/surface";
import { EmploymentTypeChip } from "@/components/teachers/employment-type-chip";
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
import { ARAL_TUTOR_SORTS, type AralTutorSort } from "@/lib/admin/aral-tutor-sorts";
import type { AralTutorRow } from "@/lib/admin/aral-tutors";

export type AralTutorsTableList = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  q: string;
};

type AralTutorsTableProps = {
  rows: AralTutorRow[];
  list: AralTutorsTableList;
  basePath: string;
  filters: ListFilterField[];
  /** Admin page: adds the School column. */
  showSchool?: boolean;
  sort: AralTutorSort;
  /** Params that survive "Clear filters" (a Super Admin's `schoolId` view context). */
  keepParams?: readonly string[];
  /** Where "Clear filters" in the empty state goes; defaults to `basePath`. */
  clearHref?: string;
};

/** "Grade 3 (4) · Grade 4 (2)" */
export function formatTutorGrades(grades: AralTutorRow["grades"]): string {
  return grades.map((g) => `${g.label} (${g.count.toLocaleString()})`).join(" · ");
}

function EmploymentCell({ row, dash = false }: { row: AralTutorRow; dash?: boolean }) {
  if (!row.employment) return dash ? <span className="text-muted-foreground">—</span> : null;
  return (
    <EmploymentTypeChip
      employmentType={row.employment === "DEPED" ? "DEPED_PLANTILLA" : "NON_DEPED"}
    />
  );
}

/** Tutor list: filters, sort, table, pager. One navigation provider for all. */
export function AralTutorsTable(props: AralTutorsTableProps) {
  return (
    <ListNavigationProvider>
      <AralTutorsTableInner {...props} />
    </ListNavigationProvider>
  );
}

function AralTutorsTableInner({
  rows,
  list,
  basePath,
  filters,
  showSchool = false,
  sort,
  keepParams,
  clearHref,
}: AralTutorsTableProps) {
  const active = describeActiveFilters(filters, list.q);
  const searchOnly = filters.every((f) => !f.value);
  const columns = showSchool ? 6 : 5;

  return (
    <div className="space-y-4">
      <Surface as="section" aria-label="Find ARAL tutors" className="rounded-2xl p-3 sm:p-4">
        <ListFilterBar
          basePath={basePath}
          q={list.q}
          resultCount={list.totalCount}
          searchLabel="Search ARAL tutors"
          searchPlaceholder="Teacher name…"
          fields={filters}
          sort={{ value: sort, options: ARAL_TUTOR_SORTS.options }}
          keepParams={keepParams}
        />
      </Surface>

      <Surface as="section" className="min-w-0 space-y-3 overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 px-3 pt-4 sm:px-4">
          <h2 className="text-base font-semibold">
            ARAL tutors{" "}
            <span className="text-muted-foreground">({list.totalCount.toLocaleString()})</span>
          </h2>
          <span className="text-xs text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
        </div>
        <ListBusyRegion
          label="ARAL tutors"
          skeleton={<TableSectionSkeleton rows={8} columns={columns} showToolbar={false} />}
        >
          {rows.length === 0 ? (
            <div className="px-4 pb-4">
              {list.totalCount > 0 ? (
                <PageOutOfRangeState
                  basePath={basePath}
                  page={list.page}
                  totalPages={list.totalPages}
                  totalCount={list.totalCount}
                  noun="tutors"
                />
              ) : active.length > 0 ? (
                <EmptyState
                  title="No tutors match"
                  description={`Nothing matches ${active.join(" · ")}. ${
                    searchOnly ? "Try a different search or clear it." : "Try a wider filter or clear them."
                  }`}
                  actionHref={clearHref ?? basePath}
                  actionLabel="Clear filters"
                  icon={HandHelping}
                />
              ) : (
                <EmptyState
                  title="No teacher is tutoring ARAL learners yet"
                  description="Teachers appear here once they are designated as the ARAL tutor of at least one learner."
                  icon={HandHelping}
                />
              )}
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4 text-xs">Name</TableHead>
                      <TableHead className="text-xs">Employment</TableHead>
                      <TableHead className="text-xs">Advisory</TableHead>
                      <TableHead className="text-right text-xs">ARAL learners</TableHead>
                      <TableHead className={showSchool ? "text-xs" : "pr-4 text-xs"}>Grades</TableHead>
                      {showSchool ? <TableHead className="pr-4 text-xs">School</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="py-2.5 pl-4 text-sm font-medium">{row.listingName}</TableCell>
                        <TableCell className="py-2.5">
                          <EmploymentCell row={row} dash />
                        </TableCell>
                        <TableCell className="py-2.5 text-sm text-muted-foreground">
                          {row.advisorySummary ?? "No advisory"}
                        </TableCell>
                        <TableCell className="py-2.5 text-right text-sm font-semibold tabular-nums text-violet-700 dark:text-violet-300">
                          {row.aralLearnerCount.toLocaleString()}
                        </TableCell>
                        <TableCell className={showSchool ? "py-2.5 text-sm" : "py-2.5 pr-4 text-sm"}>
                          {formatTutorGrades(row.grades) || "—"}
                        </TableCell>
                        {showSchool ? (
                          <TableCell className="py-2.5 pr-4 text-sm text-muted-foreground">
                            {row.school.name}
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="divide-y divide-border/60 lg:hidden" aria-label="ARAL tutors">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-foreground">
                        <span className="truncate">{row.listingName}</span>
                        <EmploymentCell row={row} />
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {row.advisorySummary ?? "No advisory"}
                      </p>
                      {row.grades.length > 0 ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">{formatTutorGrades(row.grades)}</p>
                      ) : null}
                      {showSchool ? (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.school.name}</p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold tabular-nums text-violet-700 dark:text-violet-300">
                        {row.aralLearnerCount.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {row.aralLearnerCount === 1 ? "learner" : "learners"}
                      </p>
                    </div>
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
            noun="tutors"
          />
        ) : null}
      </Surface>
    </div>
  );
}
