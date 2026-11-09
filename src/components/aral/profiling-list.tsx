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
  CellText,
  NoValue,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
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
  "inline-flex items-center whitespace-nowrap rounded-sm bg-muted px-2 py-0.5 text-xs text-muted-foreground";

/**
 * ARAL Profiling's desktop table + phone card list, following the
 * desktop-table-plus-phone-list split `LearnerListClient` uses (table `md`
 * and up, one card per learner below it). Rows are numbered by absolute
 * position across pages, not per-page index.
 */

function ProfileStatusBadge({ done }: { done: boolean }) {
  return (
    <Badge variant={done ? "violet" : "outline"} className="shrink-0">
      {done ? "Completed" : "Pending"}
    </Badge>
  );
}

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


  /** The row's one job (complete or update the profile), so it stays visible. */
  const profileAction = (r: (typeof rows)[number], className?: string) => (
    <Button asChild size="sm" variant={r.done ? "outline" : "default"} className={className}>
      <Link href={r.updateHref}>{r.done ? "Update profile" : "Complete profile"}</Link>
    </Button>
  );

  return (
    <Surface as="section" className="overflow-hidden rounded-lg">
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
                ? "Learners you teach in the ARAL program appear here."
                : "Switch tabs or clear a filter to see the other learners."
            }
          />
        </div>
      ) : (
        <ResponsiveTable
          table={
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead numeric className={cn(HEAD_CLASS, "w-10")}>#</TableHead>
                  <TableHead className={HEAD_CLASS}>Learner</TableHead>
                  <TableHead className={HEAD_CLASS}>Grade</TableHead>
                  <TableHead className={HEAD_CLASS}>Section</TableHead>
                  <TableHead className={HEAD_CLASS}>Profile Status</TableHead>
                  <TableHead className={HEAD_CLASS}>Last Updated</TableHead>
                  {canEdit && (
                    <TableHead className={HEAD_CLASS}>
                      <span className="sr-only">Action</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell numeric className="text-muted-foreground">
                      {rowNumber(i)}
                    </TableCell>
                    <TableCell className="max-w-[18rem] font-medium">
                      <CellText>{r.fullName}</CellText>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">{r.gradeLabel}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.sectionName ?? <NoValue />}
                    </TableCell>
                    <TableCell>
                      <ProfileStatusBadge done={r.done} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm tabular-nums text-muted-foreground">
                      {r.lastUpdatedDisplay}
                    </TableCell>
                    {canEdit && (
                      <TableCell>
                        <div className="flex justify-end">{profileAction(r)}</div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          }
          stacked={
            <StackedList aria-label="ARAL learners">
              {rows.map((r, i) => (
                <StackedRow
                  key={r.id}
                  className="sm:px-4"
                  leading={
                    <span className="inline-block w-6 text-right text-xs tabular-nums text-muted-foreground">
                      {rowNumber(i)}
                    </span>
                  }
                  title={r.fullName}
                  state={<ProfileStatusBadge done={r.done} />}
                  meta={
                    <>
                      <span className={PILL_CLASS}>{r.gradeLabel}</span>
                      {r.sectionName ? <span className={PILL_CLASS}>{r.sectionName}</span> : null}
                      <span>Updated {r.lastUpdatedDisplay}</span>
                    </>
                  }
                >
                  {canEdit ? profileAction(r, "w-fit") : null}
                </StackedRow>
              ))}
            </StackedList>
          }
        />
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
