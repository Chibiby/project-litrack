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
  CellText,
  NoValue,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import {
  ListFilterBar,
  describeActiveFilters,
  type ListFilterField,
} from "@/components/admin/management/list-filter-bar";
import { ListPager, PageOutOfRangeState } from "@/components/admin/management/list-pager";
import { ARAL_TEACHER_SORTS, type AralTeacherSort } from "@/lib/admin/aral-teacher-sorts";
import type { AralTeacherRow } from "@/lib/admin/aral-teachers";

export type AralTeachersTableList = {
  page: number;
  pageSize: number;
  totalPages: number;
  totalCount: number;
  q: string;
};

type AralTeachersTableProps = {
  rows: AralTeacherRow[];
  list: AralTeachersTableList;
  basePath: string;
  filters: ListFilterField[];
  /** Admin page: adds the School column. */
  showSchool?: boolean;
  sort: AralTeacherSort;
  /** Params that survive "Clear filters" (a Super Admin's `schoolId` view context). */
  keepParams?: readonly string[];
  /** Where "Clear filters" in the empty state goes; defaults to `basePath`. */
  clearHref?: string;
};

/** "Grade 3 (4) · Grade 4 (2)" */
export function formatTeacherGrades(grades: AralTeacherRow["grades"]): string {
  return grades.map((g) => `${g.label} (${g.count.toLocaleString()})`).join(" · ");
}

function EmploymentCell({ row, dash = false }: { row: AralTeacherRow; dash?: boolean }) {
  if (!row.employment) return dash ? <span className="text-muted-foreground">—</span> : null;
  return (
    <EmploymentTypeChip
      employmentType={row.employment === "DEPED" ? "DEPED_PLANTILLA" : "NON_DEPED"}
    />
  );
}

/** ARAL teacher list: filters, sort, table, pager. One navigation provider for all. */
export function AralTeachersTable(props: AralTeachersTableProps) {
  return (
    <ListNavigationProvider>
      <AralTeachersTableInner {...props} />
    </ListNavigationProvider>
  );
}

function AralTeachersTableInner({
  rows,
  list,
  basePath,
  filters,
  showSchool = false,
  sort,
  keepParams,
  clearHref,
}: AralTeachersTableProps) {
  const active = describeActiveFilters(filters, list.q);
  const searchOnly = filters.every((f) => !f.value);
  const columns = showSchool ? 6 : 5;

  return (
    <div className="space-y-4">
      <Surface as="section" aria-label="Find ARAL teachers" className="rounded-lg p-3 sm:p-4">
        <ListFilterBar
          basePath={basePath}
          q={list.q}
          resultCount={list.totalCount}
          searchLabel="Search ARAL teachers"
          searchPlaceholder="Teacher name…"
          fields={filters}
          sort={{ value: sort, options: ARAL_TEACHER_SORTS.options }}
          keepParams={keepParams}
        />
      </Surface>

      <Surface as="section" className="min-w-0 space-y-3 overflow-hidden rounded-lg">
        <div className="flex items-center justify-between gap-3 px-3 pt-4 sm:px-4">
          <h2 className="text-base font-semibold">
            ARAL teachers{" "}
            <span className="text-muted-foreground">({list.totalCount.toLocaleString()})</span>
          </h2>
          <span className="text-xs text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
        </div>
        <ListBusyRegion
          label="ARAL teachers"
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
                  noun="teachers"
                />
              ) : active.length > 0 ? (
                <EmptyState
                  title="No teachers match"
                  description={`Nothing matches ${active.join(" · ")}. ${
                    searchOnly ? "Try a different search or clear it." : "Try a wider filter or clear them."
                  }`}
                  actionHref={clearHref ?? basePath}
                  actionLabel="Clear filters"
                  icon={HandHelping}
                />
              ) : (
                <EmptyState
                  title="No ARAL teachers yet"
                  description="Teachers appear here once they are designated as the ARAL teacher of at least one learner."
                  icon={HandHelping}
                />
              )}
            </div>
          ) : (
            <ResponsiveTable
              // Wide roster: the full table needs ~1300px of its own width.
              breakpoint={1300}
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Name</TableHead>
                      <TableHead>Employment</TableHead>
                      <TableHead>Advisory</TableHead>
                      <TableHead numeric>ARAL learners</TableHead>
                      <TableHead className={showSchool ? undefined : "pr-4"}>Grades</TableHead>
                      {showSchool ? <TableHead className="pr-4">School</TableHead> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="max-w-64 pl-4 font-medium">
                          <CellText>{row.listingName}</CellText>
                        </TableCell>
                        <TableCell>
                          <EmploymentCell row={row} dash />
                        </TableCell>
                        <TableCell className="max-w-64 text-muted-foreground">
                          <CellText>{row.advisorySummary ?? "No advisory"}</CellText>
                        </TableCell>
                        <TableCell
                          numeric
                          className="font-semibold text-aral-700 dark:text-aral-300"
                        >
                          {row.aralLearnerCount.toLocaleString()}
                        </TableCell>
                        <TableCell className={showSchool ? undefined : "pr-4"}>
                          {formatTeacherGrades(row.grades) || <NoValue />}
                        </TableCell>
                        {showSchool ? (
                          <TableCell className="max-w-64 pr-4 text-muted-foreground">
                            <CellText>{row.school.name}</CellText>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
              stacked={
                <StackedList aria-label="ARAL teachers">
                  {rows.map((row) => (
                    <StackedRow
                      key={row.id}
                      title={row.listingName}
                      value={
                        <span className="text-aral-700 dark:text-aral-300">
                          {row.aralLearnerCount.toLocaleString()}
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            {row.aralLearnerCount === 1 ? "learner" : "learners"}
                          </span>
                        </span>
                      }
                      state={<EmploymentCell row={row} />}
                      meta={<span className="truncate">{row.advisorySummary ?? "No advisory"}</span>}
                      details={[
                        {
                          label: "Grades",
                          value: formatTeacherGrades(row.grades) || <NoValue />,
                        },
                        ...(showSchool ? [{ label: "School", value: row.school.name }] : []),
                      ]}
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
            noun="teachers"
          />
        ) : null}
      </Surface>
    </div>
  );
}
