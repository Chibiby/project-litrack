"use client";

import { useState } from "react";
import { ArrowRightLeft, GraduationCap, Inbox, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  LearnersDirectory,
  type LearnersDirectoryList,
} from "@/components/admin/management/learners-directory";
import type { ListFilterField } from "@/components/admin/management/list-filter-bar";
import { TransferLearnersDialog } from "@/components/learners/transfer-learners-dialog";
import { TransferRequestedBadge } from "@/components/learners/transfer-requested-badge";
import type { TransferCandidate, TransferDestination } from "@/components/learners/transfer-eligibility";
import type { LearnerHubRow } from "@/lib/admin/management";
import type { PendingTransfer } from "@/lib/learners/section-transfer-queries";
import {
  ChangeGradeDialog,
  type ChangeGradeLearner,
  type ChangeGradeOptions,
} from "./change-grade-dialog";
import { READ_ONLY_CAPTION } from "./transfer-requests-panel";

type Props = {
  rows: LearnerHubRow[];
  list: LearnersDirectoryList;
  basePath: string;
  filters: ListFilterField[];
  keepParams?: readonly string[];
  clearHref?: string;
  emptyDescription?: string;
  /** Super Admin drill-down: no selection, no actions. */
  readOnly: boolean;
  /** The transfer reads failed: the directory still lists, but Transfer is off. */
  transfersUnavailable?: boolean;
  destinations: TransferDestination[];
  /** Waiting request per learner id, for the badge and "Review request". */
  pendingByLearner: Record<string, PendingTransfer>;
  /** Null in a read-only view. */
  changeGrade: ChangeGradeOptions | null;
};

function candidateOf(row: LearnerHubRow, pending: Record<string, PendingTransfer>): TransferCandidate {
  return {
    id: row.id,
    name: row.listingName,
    gradeLevelId: row.gradeLevelId,
    gradeLabel: row.gradeLabel,
    gradeType: row.grade,
    sectionId: row.sectionId,
    archived: row.archived,
    pendingRequest: pending[row.id] !== undefined,
  };
}

/**
 * The School Head's learner directory with selection, Transfer, Change grade
 * and the waiting-request badge layered on the shared `LearnersDirectory`.
 * Selection covers the current page only and clears when the rows change.
 */
export function SchoolHeadLearnersDirectory({
  readOnly,
  transfersUnavailable = false,
  destinations,
  pendingByLearner,
  changeGrade,
  rows,
  ...directory
}: Props) {
  const unavailableLine = transfersUnavailable ? (
    <span role="status" className="text-xs text-destructive">
      Couldn&apos;t load transfer requests. Refresh the page to try again.
    </span>
  ) : null;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transferIds, setTransferIds] = useState<string[] | null>(null);
  const [gradeTarget, setGradeTarget] = useState<ChangeGradeLearner | null>(null);

  const [prevRows, setPrevRows] = useState(rows);
  if (rows !== prevRows) {
    setPrevRows(rows);
    setSelected(new Set());
  }

  const candidates = (transferIds ?? []).flatMap((id) => {
    const row = rows.find((r) => r.id === id);
    return row ? [candidateOf(row, pendingByLearner)] : [];
  });

  const rowBadge = (row: LearnerHubRow) => {
    const p = pendingByLearner[row.id];
    return p ? <TransferRequestedBadge toSectionName={p.toSectionName} className="mt-1 flex w-fit" /> : null;
  };

  if (readOnly) {
    return (
      <LearnersDirectory
        {...directory}
        rows={rows}
        hideSchool
        rowBadge={rowBadge}
        bulkActions={
          <span className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{READ_ONLY_CAPTION}</span>
            {unavailableLine}
          </span>
        }
      />
    );
  }

  const rowActions = (row: LearnerHubRow) => {
    const pending = pendingByLearner[row.id];
    const floating = row.grade === "FLOATING";
    return (
      // Not modal: its items open dialogs, and a modal menu handing focus to a
      // modal dialog loops between the two focus traps.
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="size-11 rounded-xl lg:size-9"
            aria-label={`Actions for ${row.listingName}`}
          >
            <MoreVertical className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {pending ? (
            <DropdownMenuItem asChild>
              <a
                href={`#transfer-request-${pending.requestId}`}
                onClick={(e) => {
                  // The panel lists only the oldest requests; a newer one has no row to land on.
                  if (!document.getElementById(`transfer-request-${pending.requestId}`)) {
                    e.preventDefault();
                    window.location.hash = "transfer-requests";
                    document.getElementById("transfer-requests")?.scrollIntoView();
                  }
                }}
              >
                <Inbox className="size-4" aria-hidden />
                Review request
              </a>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={transfersUnavailable || row.archived || floating}
              onSelect={() => setTransferIds([row.id])}
            >
              <ArrowRightLeft className="size-4" aria-hidden />
              Transfer
              {transfersUnavailable || row.archived || floating ? (
                <span className="ml-auto text-xs text-muted-foreground">
                  {transfersUnavailable ? "Unavailable" : row.archived ? "Archived" : "Use Change grade"}
                </span>
              ) : null}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={row.archived}
            onSelect={() =>
              setGradeTarget({
                id: row.id,
                name: row.listingName,
                gradeLevelId: row.gradeLevelId,
                gradeLabel: row.gradeLabel,
                floating,
              })
            }
          >
            <GraduationCap className="size-4" aria-hidden />
            Change grade
            {row.archived ? <span className="ml-auto text-xs text-muted-foreground">Archived</span> : null}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const pickedOnPage = rows.filter((r) => selected.has(r.id)).map((r) => r.id);

  return (
    <>
      <LearnersDirectory
        {...directory}
        rows={rows}
        hideSchool
        selection={transfersUnavailable ? undefined : { selectedIds: selected, onChange: setSelected }}
        rowBadge={rowBadge}
        rowActions={rowActions}
        bulkActions={
          transfersUnavailable ? (
            unavailableLine
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pickedOnPage.length === 0}
              onClick={() => setTransferIds(pickedOnPage)}
            >
              <ArrowRightLeft className="size-4" aria-hidden />
              Transfer selected{pickedOnPage.length > 0 ? ` (${pickedOnPage.length})` : ""}
            </Button>
          )
        }
      />

      <TransferLearnersDialog
        mode="transfer"
        open={transferIds !== null}
        candidates={candidates}
        destinations={destinations}
        onClose={() => setTransferIds(null)}
        onDone={() => setSelected(new Set())}
      />

      {changeGrade ? (
        <ChangeGradeDialog learner={gradeTarget} options={changeGrade} onClose={() => setGradeTarget(null)} />
      ) : null}
    </>
  );
}
