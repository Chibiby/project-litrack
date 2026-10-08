import type { GradeLevelType, UserRole } from "@prisma/client";

/**
 * Whether a learner may move to a section, decided in one place.
 *
 * Pure on purpose: no `server-only`, no database client. The server actions use
 * it to enforce the rule and client components use it to leave ineligible rows
 * out before submitting, so the two can never disagree.
 */

/** The largest page the Learners directory offers (`LEARNER_PAGE_SIZE_OPTIONS`). */
export const MAX_TRANSFER_BATCH = 100;

export type TransferLearnerFacts = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  gradeType: GradeLevelType;
  sectionId: string | null;
  deletedAt: Date | null;
  archivedAt: Date | null;
};

export type TransferDestinationFacts = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  deletedAt: Date | null;
  gradeDeletedAt: Date | null;
  adviser: {
    id: string;
    deletedAt: Date | null;
    isActive: boolean;
    role: UserRole;
  } | null;
} | null;

export type TransferBlockReason =
  | "learner-unavailable"
  | "floating"
  | "different-grade"
  | "section-unavailable"
  | "no-adviser"
  | "moved-since-request"
  | "not-in-advisory"
  | "pending-request";

export type TransferVerdict =
  | { ok: true; kind: "move"; teacherId: string }
  | { ok: true; kind: "unchanged" }
  | { ok: false; reason: TransferBlockReason };

export type EvaluateSectionTransferInput = {
  actorSchoolId: string;
  learner: TransferLearnerFacts | null;
  destination: TransferDestinationFacts;
  /** Approval only: the section the learner was in when the request was made. */
  expectedFromSectionId?: string | null;
  hasPendingRequest: boolean;
  /** Teacher request only: the sections the teacher advises. */
  advisedSectionIds?: string[];
};

/** One sentence per reason, finishing "can't move to <section>: ...". */
export const TRANSFER_BLOCK_REASON_LABELS: Record<TransferBlockReason, string> = {
  "learner-unavailable": "the learner is archived or no longer on the roster",
  floating: "the learner has no grade placement yet, so there is no section to move within",
  "different-grade": "a transfer stays inside one grade",
  "section-unavailable": "that section is no longer available",
  "no-adviser": "that section has no active adviser yet",
  "moved-since-request": "the learner has already moved to a different section since the request",
  "not-in-advisory": "the learner is not in a section you advise",
  "pending-request": "a transfer request is already waiting for a decision",
};

/** Checks run in this fixed order; the first failure is the one reported. */
export function evaluateSectionTransfer(input: EvaluateSectionTransferInput): TransferVerdict {
  const { actorSchoolId, learner, destination, expectedFromSectionId, hasPendingRequest, advisedSectionIds } =
    input;
  const block = (reason: TransferBlockReason): TransferVerdict => ({ ok: false, reason });

  // 1. learner gone or archived
  if (!learner || learner.schoolId !== actorSchoolId || learner.deletedAt || learner.archivedAt) {
    return block("learner-unavailable");
  }
  // 2. floating grade
  if (learner.gradeType === "FLOATING") return block("floating");
  // 3. destination missing, archived, elsewhere, or its grade archived
  if (
    !destination ||
    destination.schoolId !== actorSchoolId ||
    destination.deletedAt ||
    destination.gradeDeletedAt
  ) {
    return block("section-unavailable");
  }
  // 4. different grade
  if (destination.gradeLevelId !== learner.gradeLevelId) return block("different-grade");
  // 5. no usable adviser
  const adviser = destination.adviser;
  if (!adviser || adviser.deletedAt || !adviser.isActive || adviser.role !== "TEACHER") {
    return block("no-adviser");
  }
  // 6. moved since the request
  if (expectedFromSectionId !== undefined && learner.sectionId !== expectedFromSectionId) {
    return block("moved-since-request");
  }
  // 7. outside the teacher's advisory
  if (advisedSectionIds && (learner.sectionId === null || !advisedSectionIds.includes(learner.sectionId))) {
    return block("not-in-advisory");
  }
  // 8. a request is already waiting
  if (hasPendingRequest) return block("pending-request");
  // 9. already there: fine, nothing to do
  if (learner.sectionId === destination.id) return { ok: true, kind: "unchanged" };

  return { ok: true, kind: "move", teacherId: adviser.id };
}
