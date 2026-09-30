"use client";

import { useState } from "react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { MOSY_STATUS_LABELS, type MosyRowStatus, type MosyStatusFilter } from "@/lib/aral/mosy";
import type { MosyRow } from "@/lib/aral/mosy-queries";
import { cn } from "@/lib/utils";

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

function PreviousLevelCell({ row }: { row: MosyRow }) {
  const prev = row.previousLevel;
  if (!prev || (!prev.filipino && !prev.english)) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-0.5 text-sm">
      {prev.filipino ? (
        <p>
          <span className="text-muted-foreground">Fil:</span> {prev.filipino}
        </p>
      ) : null}
      {prev.english ? (
        <p>
          <span className="text-muted-foreground">Eng:</span> {prev.english}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">{prev.monthLabel}</p>
    </div>
  );
}

/**
 * MOSY Report table. Changing a row's level select opens the decision dialog
 * with that level as a draft; nothing is saved until the dialog is confirmed,
 * and closing it drops the draft (the select is derived from saved data, so it
 * snaps back on its own). Scrolls horizontally below the widest column set.
 */
export function MosyTable({
  rows,
  totalCount,
  page,
  pageSize,
  totalPages,
  status,
  canEdit,
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
  schoolIdParam?: string;
  q?: string;
  gradeParam?: string;
  sectionParam?: string;
}) {
  const [dialog, setDialog] = useState<MosyDialogState | null>(null);
  const rowNumber = (i: number) => (page - 1) * pageSize + i + 1;

  return (
    <Surface as="section" className="overflow-hidden rounded-2xl">
      <ListBusyRegion
        label="MOSY report"
        skeleton={<TableSectionSkeleton rows={8} columns={8} showToolbar={false} />}
      >
        {totalCount === 0 ? (
          <div className="p-4">
            <EmptyState
              title={status === "all" ? "No ARAL learners" : "No learners match this status"}
              description={
                status === "all"
                  ? "ARAL learners you tutor appear here so you can record their MOSY level and decision."
                  : "Change the ARAL status or clear a filter to see the other learners."
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table className="min-w-[60rem]">
              <TableHeader>
                <TableRow>
                  <TableHead className={cn(HEAD_CLASS, "w-10")}>#</TableHead>
                  <TableHead className={HEAD_CLASS}>Learner name</TableHead>
                  <TableHead className={HEAD_CLASS}>Grade &amp; section</TableHead>
                  <TableHead className={HEAD_CLASS}>Previous level</TableHead>
                  <TableHead className={HEAD_CLASS}>MOSY reading level</TableHead>
                  <TableHead className={HEAD_CLASS}>ARAL status decision</TableHead>
                  <TableHead className={HEAD_CLASS}>Remarks / Reason</TableHead>
                  <TableHead className={cn(HEAD_CLASS, "text-right")}>Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r, i) => {
                  const inDialog = dialog?.row.id === r.id;
                  const shownLevel = inDialog ? dialog.draftLevel : (r.mosyLevel ?? "");
                  const needsLevel = !r.mosyLevel;
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
                        <PreviousLevelCell row={r} />
                      </TableCell>
                      <TableCell className="min-w-[13rem]">
                        <Select
                          value={shownLevel}
                          disabled={!canEdit}
                          onValueChange={(value) =>
                            setDialog({ row: r, draftLevel: value })
                          }
                        >
                          <SelectTrigger
                            aria-label={`MOSY reading level for ${r.fullName}`}
                            className="h-9 lg:h-9"
                          >
                            <SelectValue placeholder="Select level" />
                          </SelectTrigger>
                          <SelectContent>
                            {r.levelOptions.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <StatusChip status={r.status} />
                      </TableCell>
                      <TableCell className="max-w-[16rem] text-sm">
                        {r.reasonLabel || r.remarks ? (
                          <div className="space-y-0.5">
                            {r.reasonLabel ? (
                              <p className="font-medium text-foreground">{r.reasonLabel}</p>
                            ) : null}
                            {r.remarks ? (
                              <p
                                className="truncate text-muted-foreground"
                                title={r.remarks}
                              >
                                {r.remarks}
                              </p>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className="inline-flex"
                          title={needsLevel ? "Choose a MOSY reading level first" : undefined}
                        >
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!canEdit || needsLevel}
                            aria-label={`Update MOSY decision for ${r.fullName}`}
                            aria-describedby={needsLevel ? `mosy-hint-${r.id}` : undefined}
                            onClick={() =>
                              setDialog({ row: r, draftLevel: r.mosyLevel ?? "" })
                            }
                          >
                            Update
                          </Button>
                          {needsLevel ? (
                            <span id={`mosy-hint-${r.id}`} className="sr-only">
                              Choose a MOSY reading level first
                            </span>
                          ) : null}
                        </span>
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

      <MosyDecisionDialog state={dialog} onClose={() => setDialog(null)} />
    </Surface>
  );
}
