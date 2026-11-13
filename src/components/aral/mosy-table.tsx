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
  CellText,
  NoValue,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
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
    "border-warning-200 bg-warning-50 text-warning-900 dark:border-warning-900/60 dark:bg-warning-950/40 dark:text-warning-200",
  moved_out: "border-transparent bg-muted text-foreground",
  stay: "border-aral-200 bg-aral-soft text-aral dark:border-aral-900/60",
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
    return <NoValue />;
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
  /** The row's one job, so it stays visible rather than revealing on hover. */
  const updateButton = (r: (typeof rows)[number]) => (
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
  );

  return (
    <Surface as="section" className="overflow-hidden rounded-lg">
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
          <ResponsiveTable
            table={
            <Table className="min-w-[72rem]">
              <TableHeader>
                <TableRow>
                  <TableHead numeric className={cn(HEAD_CLASS, "w-10")}>#</TableHead>
                  <TableHead className={HEAD_CLASS}>Learner name</TableHead>
                  <TableHead className={HEAD_CLASS}>Grade &amp; section</TableHead>
                  <TableHead className={HEAD_CLASS}>BOSY reading level</TableHead>
                  <TableHead className={HEAD_CLASS}>MOSY reading level</TableHead>
                  <TableHead className={HEAD_CLASS}>ARAL status decision</TableHead>
                  <TableHead className={HEAD_CLASS}>Reason</TableHead>
                  <TableHead className={HEAD_CLASS}>Remarks</TableHead>
                  <TableHead className={HEAD_CLASS}>
                    <span className="sr-only">Action</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  return (
                    <TableRow key={r.id}>
                      <TableCell numeric className="text-muted-foreground">
                        {rowNumber(i)}
                      </TableCell>
                      <TableCell className="max-w-72 font-medium">
                        <CellText>{r.fullName}</CellText>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {r.sectionName ? `${r.gradeLabel} - ${r.sectionName}` : r.gradeLabel}
                      </TableCell>
                      <TableCell>
                        <BosyLevelCell row={r} />
                      </TableCell>
                      <TableCell className="min-w-52">
                        {r.mosyLevelLabel ? (
                          <span className="text-sm">
                            <LanguageTag language={r.mosyLanguage} />
                            {r.mosyLevelLabel}
                          </span>
                        ) : (
                          <NoValue />
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusChip status={r.status} />
                      </TableCell>
                      <TableCell className="min-w-48 max-w-64 text-sm">
                        {r.reasonLabel ? (
                          r.reasonLabel
                        ) : (
                          <NoValue />
                        )}
                      </TableCell>
                      <TableCell className="min-w-40 max-w-64 text-sm">
                        {/* Wrapped in full rather than truncated behind a hover
                            title, which keyboard and touch users cannot open.
                            Remarks are capped at MOSY_REMARKS_MAX characters. */}
                        {r.remarks ? (
                          <p className="whitespace-normal break-words">{r.remarks}</p>
                        ) : (
                          <NoValue />
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {updateButton(r)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            }
            stacked={
              <StackedList aria-label="MOSY report">
                {rows.map((r, i) => (
                  <StackedRow
                    key={r.id}
                    leading={
                      <span className="inline-block w-6 text-right text-xs tabular-nums text-muted-foreground">
                        {rowNumber(i)}
                      </span>
                    }
                    title={r.fullName}
                    state={<StatusChip status={r.status} />}
                    meta={
                      <span className="truncate">
                        {r.sectionName ? `${r.gradeLabel} - ${r.sectionName}` : r.gradeLabel}
                      </span>
                    }
                    details={[
                      { label: "BOSY reading level", value: <BosyLevelCell row={r} /> },
                      {
                        label: "MOSY reading level",
                        value: r.mosyLevelLabel ? (
                          <span className="text-sm">
                            <LanguageTag language={r.mosyLanguage} />
                            {r.mosyLevelLabel}
                          </span>
                        ) : (
                          <NoValue />
                        ),
                      },
                      { label: "Reason", value: r.reasonLabel ?? <NoValue /> },
                      { label: "Remarks", value: r.remarks ?? <NoValue /> },
                    ]}
                    actions={updateButton(r)}
                  />
                ))}
              </StackedList>
            }
          />
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
