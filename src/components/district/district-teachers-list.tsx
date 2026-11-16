"use client";

import { Users } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
import { Surface } from "@/components/ui/surface";
import { ListNavigationProvider } from "@/components/nav/list-navigation";
import { ListBusyRegion, TableSectionSkeleton } from "@/components/loading";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import {
  ListFilterBar,
  describeActiveFilters,
  type ListFilterField,
} from "@/components/admin/management/list-filter-bar";
import { ListPager, PageOutOfRangeState } from "@/components/admin/management/list-pager";
import type { DistrictTeacherRow } from "@/lib/admin/management";

type Props = {
  rows: DistrictTeacherRow[];
  filters: ListFilterField[];
  basePath: string;
  list: { page: number; pageSize: number; totalPages: number; totalCount: number; q: string };
};

function StatusBadge({ row }: { row: DistrictTeacherRow }) {
  if (row.approvalStatus === "PENDING") {
    return <Badge className="border-warning-300 bg-warning-50 text-warning-900 hover:bg-warning-50 dark:border-warning-700 dark:bg-transparent dark:text-warning-300">Pending approval</Badge>;
  }
  if (row.approvalStatus === "REJECTED") return <Badge variant="secondary">Rejected</Badge>;
  return row.isActive ? (
    <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Active</Badge>
  ) : (
    <Badge variant="secondary">Inactive</Badge>
  );
}

function advisoryText(row: DistrictTeacherRow): string | null {
  if (row.advisoryMode === "FLOATING") return "Floating (no advisory)";
  return row.advisory.length > 0 ? row.advisory.join(", ") : null;
}

function NoValue() {
  return (
    <span className="text-muted-foreground">
      —<span className="sr-only">Not set</span>
    </span>
  );
}

/**
 * A district admin's teacher list: search, filters, table, pager. Read-only:
 * no row opens an admin page and nothing here touches an account.
 */
export function DistrictTeachersList(props: Props) {
  return (
    <ListNavigationProvider>
      <Inner {...props} />
    </ListNavigationProvider>
  );
}

function Inner({ rows, filters, basePath, list }: Props) {
  const active = describeActiveFilters(filters, list.q);
  return (
    <div className="space-y-4">
      <Surface as="section" aria-label="Find teachers" className="rounded-lg p-3 sm:p-4">
        <ListFilterBar
          basePath={basePath}
          q={list.q}
          resultCount={list.totalCount}
          searchLabel="Search teachers"
          searchPlaceholder="Teacher or school name…"
          fields={filters}
        />
      </Surface>
      <Surface as="section" className="min-w-0 space-y-3 overflow-hidden rounded-lg">
        <div className="flex items-center justify-between gap-3 px-3 pt-4 sm:px-4">
          <h2 className="text-base font-semibold">
            Teachers <span className="text-muted-foreground">({list.totalCount.toLocaleString()})</span>
          </h2>
          <span className="text-xs text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
        </div>
        <ListBusyRegion label="teachers" skeleton={<TableSectionSkeleton rows={10} columns={4} showToolbar={false} />}>
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
                  description={`Nothing matches ${active.join(" · ")}. Try a wider filter or clear them.`}
                  actionHref={basePath}
                  actionLabel="Clear filters"
                  icon={Users}
                />
              ) : (
                <EmptyState title="No teachers yet" description="Teachers appear here once they join your schools." icon={Users} />
              )}
            </div>
          ) : (
            <ResponsiveTable
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Name</TableHead>
                      <TableHead>School</TableHead>
                      <TableHead>Advisory</TableHead>
                      <TableHead className="pr-4">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => {
                      const advisory = advisoryText(row);
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="pl-4 font-medium">
                            <span className="block max-w-[16rem] truncate" title={row.listingName}>
                              {row.listingName}
                            </span>
                          </TableCell>
                          <TableCell>
                            {row.school ? (
                              <span className="block max-w-[16rem] truncate" title={row.school.name}>
                                {row.school.name}
                              </span>
                            ) : (
                              <NoValue />
                            )}
                          </TableCell>
                          <TableCell>
                            {advisory ? (
                              <span className="block max-w-[18rem] truncate" title={advisory}>
                                {advisory}
                              </span>
                            ) : (
                              <NoValue />
                            )}
                          </TableCell>
                          <TableCell className="pr-4">
                            <StatusBadge row={row} />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              }
              stacked={
                <StackedList aria-label="Teachers">
                  {rows.map((row) => (
                    <StackedRow
                      key={row.id}
                      title={row.listingName}
                      state={<StatusBadge row={row} />}
                      meta={row.school?.name ?? "No school"}
                      details={[{ label: "Advisory", value: advisoryText(row) ?? "—" }]}
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
