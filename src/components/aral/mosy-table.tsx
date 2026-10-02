"use client";

import { useState } from "react";
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
import {
  MosyDecisionDialog,
  type MosyDialogState,
} from "@/components/aral/mosy-decision-dialog";
import { ARAL_MOSY_HREF } from "@/lib/nav/nav-config";
import {
  MOSY_LEVEL_LANGUAGE_NAMES,
  MOSY_LEVEL_LANGUAGE_PREFIXES,
  MOSY_STATUS_LABELS,
  type MosyLevelLanguage,
  type MosyRowStatus,
  type MosyStatusFilter,
} from "@/lib/aral/mosy";
import type { MosyRow } from "@/lib/aral/mosy-queries";
import { cn } from "@/lib/utils";

const LOCKED_REASON_ID = "mosy-locked-reason";
const LOCKED_REASON = "MOSY submissions are locked by your Super Admin.";

const HEAD_CLASS =
  "whitespace-nowrap text-xs font-semibold uppercase tracking-wider text-muted-foreground";

const STATUS_CHIP: Record<MosyRowStatus, string> = {
  not_updated: "border-border text-muted-foreground",
  for_decision:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200",
  moved_out: "border-transparent bg-muted text-foreground",
  stay: "border-violet-200 bg-violet-soft text-violet dark:border-violet-900/60",
};

function StatusChip({ status }: { status: MosyRowStatus }) {
  return (
    <Badge variant="outline" className={cn("whitespace-nowrap", STATUS_CHIP[status])}>
      {MOSY_STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * "Fil:" / "Eng:" on screen, the full language name for screen readers, which
 * would otherwise read the bare abbreviation.
 */
function LanguageTag({ language }: { language: MosyLevelLanguage }) {
  return (
    <>
      <span aria-hidden className="text-muted-foreground">
        {MOSY_LEVEL_LANGUAGE_PREFIXES[language]}:
      </span>
      <span className="sr-only">{MOSY_LEVEL_LANGUAGE_NAMES[language]}:</span>{" "}
    </>
  );
}

function BosyLevelCell({ row }: { row: MosyRow }) {
  const prev = row.bosyLevel;
  if (!prev || (!prev.filipino && !prev.english)) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-0.5 text-sm">
      {prev.filipino ? (
        <p>
          <LanguageTag language="FILIPINO" />
          {prev.filipino}
        </p>
      ) : null}
      {prev.english ? (
        <p>
          <LanguageTag language="ENGLISH" />
          {prev.english}
        </p>
      ) : null}
    </div>
  );
}

/**
 * MOSY Report table. The level column is read-only; Update opens the decision
 * dialog, where the level and decision are edited and saved together. Scrolls
 * horizontally below the widest column set.
 */
export function MosyTable({
  rows,
  totalCount,
  page,
  pageSize,
  totalPages,
  status,
  canEdit,
  locked = false,
  schoolIdParam,
  q,
  gradeParam,
  sectionParam,
}: {
  rows: MosyRow[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  status: MosyStatusFilter;
  canEdit: boolean;
  /** Super Admin has closed MOSY submissions: viewing stays, saving does not. */
  locked?: boolean;
  schoolIdParam?: string;
  q?: string;
  gradeParam?: string;
  sectionParam?: string;
}) {
  const [dialog, setDialog] = useState<MosyDialogState | null>(null);
  const canUpdate = canEdit && !locked;
  const rowNumber = (i: number) => (page - 1) * pageSize + i + 1;

  return (
    <Surface as="section" className="overflow-hidden rounded-2xl">
      <ListBusyRegion
        label="MOSY report"
        skeleton={<TableSectionSkeleton rows={8} columns={9} showToolbar={false} />}
      >
        {totalCount === 0 ? (
          <div className="p-4">
            <EmptyState
              title={status === "all" ? "No ARAL learners" : "No learners match this status"}
              description={
                status === "all"
                  ? "ARAL learners in your advisory appear here so you can record their MOSY level and decision."
                  : "Change the ARAL status or clear a filter to see the other learners."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[72rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className={cn(HEAD_CLASS, "w-10")}>#</TableHead>
                  <TableHead className={HEAD_CLASS}>Learner name</TableHead>
                  <TableHead className={HEAD_CLASS}>Grade &amp; section</TableHead>
                  <TableHead className={HEAD_CLASS}>BOSY reading level</TableHead>
                  <TableHead className={HEAD_CLASS}>MOSY reading level</TableHead>
                  <TableHead className={HEAD_CLASS}>ARAL status decision</TableHead>
                  <TableHead className={HEAD_CLASS}>Reason</TableHead>
                  <TableHead className={HEAD_CLASS}>Remarks</TableHead>
                  <TableHead className={cn(HEAD_CLASS, "text-right")}>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {rowNumber(i)}
                      </TableCell>
                      <TableCell className="font-medium">{r.fullName}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {r.sectionName ? `${r.gradeLabel} - ${r.sectionName}` : r.gradeLabel}
                      </TableCell>
                      <TableCell>
                        <BosyLevelCell row={r} />
                      </TableCell>
                      <TableCell className="min-w-[13rem]">
                        {r.mosyLevelLabel ? (
                          <span className="text-sm">
                            <LanguageTag language={r.mosyLanguage} />
                            {r.mosyLevelLabel}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusChip status={r.status} />
                      </TableCell>
                      <TableCell className="min-w-[12rem] max-w-[16rem] text-sm">
                        {r.reasonLabel ? (
                          r.reasonLabel
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="min-w-[10rem] max-w-[16rem] text-sm">
                        {/* Wrapped in full rather than truncated behind a hover
                            title, which keyboard and touch users cannot open.
                            Remarks are capped at MOSY_REMARKS_MAX characters. */}
                        {r.remarks ? (
                          <p className="whitespace-normal break-words">{r.remarks}</p>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canUpdate}
                          aria-label={`Update MOSY decision for ${r.fullName}`}
                          aria-describedby={locked ? LOCKED_REASON_ID : undefined}
                          title={locked ? LOCKED_REASON : undefined}
                          onClick={() => {
                            if (canUpdate) setDialog({ row: r });
                          }}
                        >
                          Update
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </ListBusyRegion>

      <LearnerPagination
        basePath={ARAL_MOSY_HREF}
        page={page}
        totalPages={totalPages}
        searchParams={{
          status: status !== "all" ? status : undefined,
          schoolId: schoolIdParam,
          q: q || undefined,
          grade: gradeParam,
          section: sectionParam,
        }}
      />

      {locked ? (
        <p id={LOCKED_REASON_ID} className="sr-only">
          {LOCKED_REASON}
        </p>
      ) : null}

      <MosyDecisionDialog state={canUpdate ? dialog : null} onClose={() => setDialog(null)} />
    </Surface>
  );
}
