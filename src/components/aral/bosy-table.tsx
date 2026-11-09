"use client";

import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { EmptyState } from "@/components/dashboard";
import { ListBusyRegion, TableSectionSkeleton } from "@/components/loading";
import { LearnerPagination } from "@/components/learners/learner-pagination";
import { ARAL_BOSY_HREF } from "@/lib/nav/nav-config";
import { BOSY_TIER_LABELS, type BosyTier, type BosyTierFilter } from "@/lib/aral/bosy";
import type { BosyRow } from "@/lib/aral/bosy-queries";
import { cn } from "@/lib/utils";

const HEAD_CLASS =
  "whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-muted-foreground";

const TIER_CHIP: Record<BosyTier, string> = {
  tier1:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  tier2: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-200",
  tier3: "border-pink-200 bg-pink-50 text-pink-900 dark:border-pink-900/60 dark:bg-pink-950/40 dark:text-pink-200",
  tier4:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200",
};

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

function LevelCell({ label, difficulties }: { label: string | null; difficulties: string[] }) {
  if (!label) return <Dash />;
  return (
    <div className="space-y-0.5 text-sm">
      <p>{label}</p>
      {difficulties.map((d) => (
        <p key={d} className="text-xs text-muted-foreground">
          {d}
        </p>
      ))}
    </div>
  );
}

/**
 * BOSY table: the reading levels recorded when each learner was enrolled.
 * Read-only — no Action column. Scrolls horizontally below the widest column set.
 */
export function BosyTable({
  rows,
  totalCount,
  page,
  pageSize,
  totalPages,
  tier,
  schoolIdParam,
  q,
  gradeParam,
  sectionParam,
}: {
  rows: BosyRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  tier: BosyTierFilter;
  schoolIdParam?: string;
  q?: string;
  gradeParam?: string;
  sectionParam?: string;
}) {
  const rowNumber = (i: number) => (page - 1) * pageSize + i + 1;

  return (
    <Surface as="section" className="overflow-hidden rounded-2xl">
      <ListBusyRegion
        label="BOSY report"
        skeleton={<TableSectionSkeleton rows={8} columns={7} showToolbar={false} />}
      >
        {totalCount === 0 ? (
          <div className="p-4">
            <EmptyState
              title={tier === "all" ? "No ARAL learners" : "No learners at this level"}
              description={
                tier === "all"
                  ? "ARAL learners in your advisory appear here with the reading levels recorded when they were enrolled."
                  : "Change the level or clear a filter to see the other learners."
              }
            />
          </div>
        ) : (
          <ResponsiveTable
            table={
            <Table className="min-w-[60rem]">
              <TableHeader>
                <TableRow>
                  <TableHead numeric className={cn(HEAD_CLASS, "w-10")}>#</TableHead>
                  <TableHead className={HEAD_CLASS}>Learner name</TableHead>
                  <TableHead className={HEAD_CLASS}>Grade &amp; section</TableHead>
                  <TableHead className={HEAD_CLASS}>BOSY Filipino level</TableHead>
                  <TableHead className={HEAD_CLASS}>BOSY English level</TableHead>
                  <TableHead className={HEAD_CLASS}>Level group</TableHead>
                  <TableHead className={HEAD_CLASS}>ARAL since</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => (
                  <TableRow key={r.id}>
                    <TableCell numeric className="text-muted-foreground">{rowNumber(i)}</TableCell>
                    <TableCell className="max-w-[18rem] font-medium">
                      {r.fullName}
                      {!r.isAralLearner ? (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">(moved out)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {r.sectionName ? `${r.gradeLabel} - ${r.sectionName}` : r.gradeLabel}
                    </TableCell>
                    <TableCell className="min-w-[13rem]">
                      <LevelCell label={r.filipinoLabel} difficulties={r.filipinoDifficulties} />
                    </TableCell>
                    <TableCell className="min-w-[13rem]">
                      {r.readsEnglish ? (
                        <LevelCell label={r.englishLabel} difficulties={r.englishDifficulties} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Not assessed in this grade</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.tier ? (
                        <Badge variant="outline" className={cn("whitespace-nowrap", TIER_CHIP[r.tier])}>
                          {BOSY_TIER_LABELS[r.tier]}
                        </Badge>
                      ) : (
                        <Dash />
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {r.aralEnrolledLabel ?? <Dash />}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            }
            stacked={
              <StackedList aria-label="BOSY report">
                {rows.map((r, i) => (
                  <StackedRow
                    key={r.id}
                    leading={
                      <span className="inline-block w-6 text-right text-xs tabular-nums text-muted-foreground">
                        {rowNumber(i)}
                      </span>
                    }
                    title={r.fullName}
                    state={
                      r.tier ? (
                        <Badge variant="outline" className={cn("whitespace-nowrap", TIER_CHIP[r.tier])}>
                          {BOSY_TIER_LABELS[r.tier]}
                        </Badge>
                      ) : undefined
                    }
                    meta={
                      <>
                        <span className="truncate">
                          {r.sectionName ? `${r.gradeLabel} - ${r.sectionName}` : r.gradeLabel}
                        </span>
                        {!r.isAralLearner ? <span>(moved out)</span> : null}
                      </>
                    }
                    details={[
                      {
                        label: "BOSY Filipino level",
                        value: <LevelCell label={r.filipinoLabel} difficulties={r.filipinoDifficulties} />,
                      },
                      {
                        label: "BOSY English level",
                        value: r.readsEnglish ? (
                          <LevelCell label={r.englishLabel} difficulties={r.englishDifficulties} />
                        ) : (
                          <span className="text-xs text-muted-foreground">Not assessed in this grade</span>
                        ),
                      },
                      { label: "ARAL since", value: r.aralEnrolledLabel ?? <Dash /> },
                    ]}
                  />
                ))}
              </StackedList>
            }
          />
        )}
      </ListBusyRegion>

      <LearnerPagination
        basePath={ARAL_BOSY_HREF}
        page={page}
        totalPages={totalPages}
        searchParams={{
          level: tier !== "all" ? tier : undefined,
          schoolId: schoolIdParam,
          q: q || undefined,
          grade: gradeParam,
          section: sectionParam,
        }}
      />
    </Surface>
  );
}
