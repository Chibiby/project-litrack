import Link from "next/link";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/dashboard";
import { ListBusyRegion, TableSectionSkeleton } from "@/components/loading";
import { LearnerPagination } from "@/components/learners/learner-pagination";
import { ARAL_PROFILING_HREF } from "@/lib/nav/nav-config";
import type { ProfilingStatusFilter } from "@/lib/aral/profiling-stats";
import { cn } from "@/lib/utils";

export type ProfilingListRow = {
  id: string;
  fullName: string;
  gradeLabel: string;
  sectionName: string | null;
  done: boolean;
  lastUpdatedDisplay: string;
  /** `/teacher/aral/${gradeLevelId}/learners/${id}/update` — built by the page. */
  updateHref: string;
};

const HEAD_CLASS =
  "whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-muted-foreground";

const PILL_CLASS =
  "inline-flex items-center whitespace-nowrap rounded-lg bg-muted px-2 py-0.5 text-xs text-muted-foreground";

/**
 * ARAL Profiling's desktop table + phone card list, following the
 * desktop-table-plus-phone-list split `LearnerListClient` uses (table `md`
 * and up, one card per learner below it). Rows are numbered by absolute
 * position across pages, not per-page index.
 */
export function ProfilingList({
  rows,
  totalCount,
  page,
  pageSize,
  totalPages,
  status,
  canEdit,
  schoolIdParam,
  q,
  sectionParam,
}: {
  rows: ProfilingListRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  status: ProfilingStatusFilter;
  canEdit: boolean;
  schoolIdParam?: string;
  q?: string;
  sectionParam?: string;
}) {
  const rowNumber = (i: number) => (page - 1) * pageSize + i + 1;

  return (
    <Surface as="section" className="overflow-hidden rounded-2xl">
      <ListBusyRegion
        label="profiles"
        skeleton={
          <TableSectionSkeleton
            rows={8}
            columns={canEdit ? 7 : 6}
            showToolbar={false}
          />
        }
      >
      {totalCount === 0 ? (
        <div className="p-4">
          <EmptyState
            title={
              status === "pending"
                ? "Every ARAL learner has a profile"
                : status === "completed"
                  ? "No completed profiles yet"
                  : "No ARAL learners"
            }
            description={
              status === "all"
                ? "Learners you tutor in the ARAL program appear here."
                : "Switch tabs or clear a filter to see the other learners."
            }
          />
        </div>
      ) : (
        <>
          {/* md and up: the full table. */}
          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className={cn(HEAD_CLASS, "w-10")}>#</TableHead>
                  <TableHead className={HEAD_CLASS}>Learner</TableHead>
                  <TableHead className={HEAD_CLASS}>Grade</TableHead>
                  <TableHead className={HEAD_CLASS}>Section</TableHead>
                  <TableHead className={HEAD_CLASS}>Profile Status</TableHead>
                  <TableHead className={HEAD_CLASS}>Last Updated</TableHead>
                  {canEdit && <TableHead className={cn(HEAD_CLASS, "text-right")}>Action</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {rowNumber(i)}
                    </TableCell>
                    <TableCell className="font-medium">{r.fullName}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.gradeLabel}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.sectionName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.done ? "violet" : "outline"}>
                        {r.done ? "Completed" : "Pending"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.lastUpdatedDisplay}
                    </TableCell>
                    {canEdit && (
                      <TableCell className="text-right">
                        <Button asChild size="sm" variant={r.done ? "outline" : "default"}>
                          <Link href={r.updateHref}>
                            {r.done ? "Update profile" : "Complete profile"}
                          </Link>
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Below md: one card per learner. */}
          <ul className="divide-y divide-border/60 md:hidden" aria-label="ARAL learners">
            {rows.map((r, i) => (
              <li key={r.id} className="flex flex-col gap-2 px-3 py-3 sm:px-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 text-sm font-medium text-foreground sm:text-base">
                    <span className="mr-1.5 text-muted-foreground">{rowNumber(i)}.</span>
                    {r.fullName}
                  </span>
                  <Badge variant={r.done ? "violet" : "outline"} className="shrink-0">
                    {r.done ? "Completed" : "Pending"}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={PILL_CLASS}>{r.gradeLabel}</span>
                  {r.sectionName ? <span className={PILL_CLASS}>{r.sectionName}</span> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  Last updated: {r.lastUpdatedDisplay}
                </p>
                {canEdit && (
                  <Button
                    asChild
                    size="sm"
                    variant={r.done ? "outline" : "default"}
                    className="mt-1 w-fit"
                  >
                    <Link href={r.updateHref}>
                      {r.done ? "Update profile" : "Complete profile"}
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      </ListBusyRegion>

      <LearnerPagination
        basePath={ARAL_PROFILING_HREF}
        page={page}
        totalPages={totalPages}
        searchParams={{
          status: status !== "all" ? status : undefined,
          schoolId: schoolIdParam,
          q: q || undefined,
          section: sectionParam,
        }}
      />
    </Surface>
  );
}
