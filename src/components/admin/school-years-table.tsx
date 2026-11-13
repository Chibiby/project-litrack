"use client";

import Link from "next/link";
import { CalendarRange, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/dashboard/empty-state";
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
  RowActions,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import {
  ListFilterBar,
  describeActiveFilters,
  type ListFilterField,
} from "@/components/admin/management/list-filter-bar";
import { ListPager, PageOutOfRangeState } from "@/components/admin/management/list-pager";
import { monthRangeLabel } from "@/components/school-head/school-year-forms";
import { ADMIN_ROUTES } from "@/lib/routes/admin";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

export type AdminSchoolYearRow = {
  id: string;
  schoolId: string;
  schoolName: string;
  district: string | null;
  label: string;
  startMonth: string;
  endMonth: string | null;
  isActive: boolean;
  enrolled: number;
};

type Props = {
  rows: AdminSchoolYearRow[];
  filters: ListFilterField[];
  list: { q: string; page: number; pageSize: number; totalPages: number; totalCount: number };
};

const BASE = ADMIN_ROUTES.schoolYears;

function StatusBadge({ active }: { active: boolean }) {
  return active ? <Badge>Active</Badge> : <Badge variant="secondary">Inactive</Badge>;
}

function OpenSchoolButton({ row }: { row: AdminSchoolYearRow }) {
  return (
    <Button asChild variant="ghost" size="icon" className="size-9 shrink-0">
      <Link
        href={`${SCHOOL_HEAD_ROUTES.schoolYears}?schoolId=${row.schoolId}`}
        aria-label={`Open ${row.schoolName}'s school years`}
      >
        <ExternalLink aria-hidden />
      </Link>
    </Button>
  );
}

/** Every school's years: search, district and status filters, pages. */
export function AdminSchoolYearsTable(props: Props) {
  return (
    <ListNavigationProvider>
      <Inner {...props} />
    </ListNavigationProvider>
  );
}

function Inner({ rows, filters, list }: Props) {
  const active = describeActiveFilters(filters, list.q);

  return (
    <div className="space-y-4">
      <Surface as="section" aria-label="Find school years" className="rounded-lg p-3 sm:p-4">
        <ListFilterBar
          basePath={BASE}
          q={list.q}
          resultCount={list.totalCount}
          searchLabel="Search schools"
          searchPlaceholder="School name…"
          fields={filters}
        />
      </Surface>

      <Surface as="section" className="min-w-0 space-y-3 overflow-hidden rounded-lg">
        <div className="flex items-center justify-between gap-3 px-3 pt-4 sm:px-4">
          <h2 className="text-base font-semibold">
            School years{" "}
            <span className="text-muted-foreground">({list.totalCount.toLocaleString()})</span>
          </h2>
          <span className="text-xs text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
        </div>
        <ListBusyRegion
          label="School years"
          skeleton={<TableSectionSkeleton rows={8} columns={6} showToolbar={false} />}
        >
          {rows.length === 0 ? (
            <div className="px-4 pb-4">
              {list.totalCount > 0 ? (
                <PageOutOfRangeState
                  basePath={BASE}
                  page={list.page}
                  totalPages={list.totalPages}
                  totalCount={list.totalCount}
                  noun="school years"
                />
              ) : active.length > 0 ? (
                <EmptyState
                  title="No school years match"
                  description={`Nothing matches ${active.join(" · ")}. Try a wider filter or clear them.`}
                  actionHref={BASE}
                  actionLabel="Clear filters"
                  icon={CalendarRange}
                />
              ) : (
                <EmptyState
                  title="No school years yet"
                  description="Add a school year to create it for every school."
                  icon={CalendarRange}
                />
              )}
            </div>
          ) : (
            <ResponsiveTable
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">School</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead>Months</TableHead>
                      <TableHead numeric>Enrolled</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="pr-4">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((y) => (
                      <TableRow key={y.id}>
                        <TableCell className="max-w-80 pl-4">
                          <CellText className="font-medium">{y.schoolName}</CellText>
                          {y.district ? (
                            <span className="block truncate text-xs text-muted-foreground">
                              {y.district}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{y.label}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {monthRangeLabel(y.startMonth, y.endMonth)}
                        </TableCell>
                        <TableCell numeric>{y.enrolled.toLocaleString()}</TableCell>
                        <TableCell>
                          <StatusBadge active={y.isActive} />
                        </TableCell>
                        <TableCell className="pr-4">
                          <RowActions>
                            <OpenSchoolButton row={y} />
                          </RowActions>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
              stacked={
                <StackedList aria-label="School years">
                  {rows.map((y) => (
                    <StackedRow
                      key={y.id}
                      title={y.schoolName}
                      value={<span className="font-medium tabular-nums">{y.label}</span>}
                      state={<StatusBadge active={y.isActive} />}
                      meta={<span>{monthRangeLabel(y.startMonth, y.endMonth)}</span>}
                      details={[
                        { label: "Enrolled", value: y.enrolled.toLocaleString() },
                        ...(y.district ? [{ label: "District", value: y.district }] : []),
                      ]}
                      actions={<OpenSchoolButton row={y} />}
                    />
                  ))}
                </StackedList>
              }
            />
          )}
        </ListBusyRegion>
        {list.totalCount > 0 ? (
          <ListPager
            basePath={BASE}
            page={list.page}
            pageSize={list.pageSize}
            totalPages={list.totalPages}
            totalCount={list.totalCount}
            noun="school years"
          />
        ) : null}
      </Surface>
    </div>
  );
}
