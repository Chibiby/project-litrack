"use client";

import { useState } from "react";
import { ArrowRightLeft, Undo2 } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { TransferLearnersDialog } from "@/components/learners/transfer-learners-dialog";
import {
  learnerVerdict,
  type TransferCandidate,
  type TransferDestination,
} from "@/components/learners/transfer-eligibility";
import {
  CancelTransferRequestConfirm,
  type CancelTransferTarget,
} from "@/components/learners/teacher-transfer-requests";
import type { LearnerProfileTransferAction } from "@/components/learners/learner-profile-modal";

/** What the teacher roster needs to offer Request transfer; absent for a Super Admin. */
export type TeacherTransferConfig = {
  destinations: TransferDestination[];
  /** Every section the teacher advises. */
  advisedSectionIds: string[];
  /** The signed-in teacher; only the request's own author may cancel it. */
  viewerId: string;
};

/** The slice of a roster row the transfer flow reads. */
export type TransferableRow = {
  id: string;
  fullName: string;
  gradeLevelId: string;
  gradeType: string;
  archivedAt: string | null;
  section: { id: string; name: string } | null;
  pendingTransfer?: { requestId: string; toSectionName: string; requestedById: string | null } | null;
};

function candidateOf(l: TransferableRow): TransferCandidate {
  return {
    id: l.id,
    name: l.fullName,
    gradeLevelId: l.gradeLevelId,
    gradeLabel: GRADE_LEVEL_LABELS[l.gradeType] ?? l.gradeType,
    gradeType: l.gradeType,
    sectionId: l.section?.id ?? null,
    archived: l.archivedAt !== null,
    pendingRequest: Boolean(l.pendingTransfer),
  };
}

/**
 * Request transfer and Cancel transfer request for the teacher roster: the row
 * menu items, the profile dialog's action, the bulk entry point and the two
 * dialogs, kept out of the roster component itself.
 */
export function useTeacherTransfers({
  config,
  onDone,
}: {
  config: TeacherTransferConfig | undefined;
  onDone: () => void;
}) {
  const [candidates, setCandidates] = useState<TransferCandidate[] | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CancelTransferTarget | null>(null);

  const eligible = (l: TransferableRow) =>
    config !== undefined && learnerVerdict(candidateOf(l), config.advisedSectionIds).ok;

  const cancelFor = (l: TransferableRow) =>
    l.pendingTransfer && config && l.pendingTransfer.requestedById === config.viewerId
      ?{ requestId: l.pendingTransfer.requestId, learnerName: l.fullName, toSectionName: l.pendingTransfer.toSectionName }
      : null;

  const openFor = (rows: TransferableRow[]) => {
    if (rows.length > 0) setCandidates(rows.map(candidateOf));
  };

  /** Row menu entry, or null when the row offers neither. */
  const menuItem = (l: TransferableRow) => {
    if (!config) return null;
    const cancel = cancelFor(l);
    if (cancel) {
      return (
        <DropdownMenuItem onSelect={() => setCancelTarget(cancel)}>
          <Undo2 className="size-4" aria-hidden />
          Cancel transfer request
        </DropdownMenuItem>
      );
    }
    if (!eligible(l)) return null;
    return (
      <DropdownMenuItem onSelect={() => openFor([l])}>
        <ArrowRightLeft className="size-4" aria-hidden />
        Request transfer
      </DropdownMenuItem>
    );
  };

  /** The profile dialog's footer action; `beforeOpen` closes the profile first. */
  const profileAction = (
    l: TransferableRow | undefined,
    beforeOpen: () => void
  ): LearnerProfileTransferAction | undefined => {
    if (!config || !l) return undefined;
    const cancel = cancelFor(l);
    if (cancel) {
      return {
        label: "Cancel transfer request",
        onSelect: () => {
          beforeOpen();
          setCancelTarget(cancel);
        },
      };
    }
    if (!eligible(l)) return undefined;
    return {
      label: "Request transfer",
      onSelect: () => {
        beforeOpen();
        openFor([l]);
      },
    };
  };

  const dialogs = config ? (
    <>
      <TransferLearnersDialog
        mode="request"
        open={candidates !== null}
        candidates={candidates ?? []}
        destinations={config.destinations}
        advisedSectionIds={config.advisedSectionIds}
        onClose={() => setCandidates(null)}
        onDone={onDone}
      />
      <CancelTransferRequestConfirm target={cancelTarget} onClose={() => setCancelTarget(null)} />
    </>
  ) : null;

  return { enabled: config !== undefined, openFor, menuItem, profileAction, dialogs };
}
