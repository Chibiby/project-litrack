"use client";

import { GraduationCap } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Badge } from "@/components/ui/badge";
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
};

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

function LearnersDirectoryInner({ rows, list, basePath, filters }: LearnersDirectoryProps) {
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
        />
      </Surface>
      <Surface as="section" className="min-w-0 space-y-3 overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between gap-3 px-3 pt-4 sm:px-4">
          <h2 className="text-base font-semibold">
            Learner directory{" "}
            <span className="text-muted-foreground">({list.totalCount.toLocaleString()})</span>
          </h2>
          <span className="text-xs text-muted-foreground">
            Page {list.page} of {list.totalPages}
          </span>
        </div>
        <ListBusyRegion
          label="learners"
          skeleton={<TableSectionSkeleton rows={10} columns={6} showToolbar={false} />}
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
                  description={`Nothing matches ${active.join(" · ")}. Try a wider filter or clear them.`}
                  actionHref={basePath}
                  actionLabel="Clear filters"
                  icon={GraduationCap}
                />
              ) : (
                <EmptyState
                  title="No enrolled learners yet"
                  description="Learners appear here once a school enrolls them in its active school year."
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
                      <TableHead className="pl-4 text-xs">Name</TableHead>
                      <TableHead className="text-xs">Sex</TableHead>
                      <TableHead className="text-xs">Grade</TableHead>
                      <TableHead className="text-xs">Section</TableHead>
                      <TableHead className="text-xs">School</TableHead>
                      <TableHead className="pr-4 text-xs">Programs</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="py-2.5 pl-4 text-sm font-medium">{row.listingName}</TableCell>
                        <TableCell className="py-2.5 text-sm">{GENDER_LABELS[row.gender]}</TableCell>
                        <TableCell className="py-2.5 text-sm">{row.gradeLabel}</TableCell>
                        <TableCell className="py-2.5 text-sm">{row.sectionName ?? "—"}</TableCell>
                        <TableCell className="py-2.5 text-sm text-muted-foreground">{row.school.name}</TableCell>
                        <TableCell className="py-2.5 pr-4">
                          <ProgramBadges row={row} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <ul className="divide-y divide-border/60 lg:hidden" aria-label="Learners">
                {rows.map((row) => (
                  <li key={row.id} className="flex items-start gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{row.listingName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {GENDER_LABELS[row.gender]} · {row.gradeLabel}
                        {row.sectionName ? ` · ${row.sectionName}` : ""}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.school.name}</p>
                    </div>
                    <div className="shrink-0">
                      <ProgramBadges row={row} />
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
            noun="learners"
          />
        ) : null}
      </Surface>
    </div>
  );
}
