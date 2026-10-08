import type { GradeLevelType } from "@prisma/client";
import {
  evaluateSectionTransfer,
  type TransferBlockReason,
  type TransferDestinationFacts,
  type TransferLearnerFacts,
  type TransferVerdict,
} from "@/lib/learners/section-transfer";
import type { TransferDestination } from "@/lib/learners/section-transfer-queries";

/**
 * Client-side eligibility for the transfer dialog, decided by the same pure
 * `evaluateSectionTransfer` the server actions run, so the dialog never sends a
 * learner the server would refuse except on a real race.
 */

export type { TransferDestination };

/** One selected learner, in the shape both rosters can build from a row. */
export type TransferCandidate = {
  id: string;
  name: string;
  gradeLevelId: string;
  gradeLabel: string;
  /** `GradeLevelType` as the row carries it; anything unknown reads as unavailable. */
  gradeType: string;
  sectionId: string | null;
  archived: boolean;
  /** A request is already waiting for this learner. */
  pendingRequest: boolean;
};

/** Every page here shows one school, so tenancy is a constant on the client. */
const SCHOOL = "school";

const GRADE_TYPES = {
  KINDER: true,
  G1: true,
  G2: true,
  G3: true,
  G4: true,
  G5: true,
  G6: true,
  G7: true,
  G8: true,
  G9: true,
  G10: true,
  G11: true,
  G12: true,
  FLOATING: true,
} satisfies Record<GradeLevelType, true>;

function isGradeLevelType(value: string): value is GradeLevelType {
  return Object.hasOwn(GRADE_TYPES, value);
}

function learnerFacts(c: TransferCandidate): TransferLearnerFacts | null {
  if (!isGradeLevelType(c.gradeType)) return null;
  return {
    id: c.id,
    schoolId: SCHOOL,
    gradeLevelId: c.gradeLevelId,
    gradeType: c.gradeType,
    sectionId: c.sectionId,
    deletedAt: null,
    archivedAt: c.archived ? new Date(0) : null,
  };
}

function destinationFacts(d: TransferDestination): TransferDestinationFacts {
  return {
    id: d.id,
    schoolId: SCHOOL,
    gradeLevelId: d.gradeLevelId,
    deletedAt: null,
    gradeDeletedAt: null,
    // `listTransferDestinations` already reports an unusable adviser as null.
    adviser: d.adviser ? { id: d.adviser.id, deletedAt: null, isActive: true, role: "TEACHER" } : null,
  };
}

/**
 * The learner-side checks only (archived, Floating, outside the advisory, a
 * request waiting), judged against a stand-in section of the learner's own
 * grade so the destination-side checks always pass.
 */
export function learnerVerdict(
  c: TransferCandidate,
  advisedSectionIds?: string[]
): TransferVerdict {
  return evaluateSectionTransfer({
    actorSchoolId: SCHOOL,
    learner: learnerFacts(c),
    destination: {
      id: "",
      schoolId: SCHOOL,
      gradeLevelId: c.gradeLevelId,
      deletedAt: null,
      gradeDeletedAt: null,
      adviser: { id: "", deletedAt: null, isActive: true, role: "TEACHER" },
    },
    hasPendingRequest: c.pendingRequest,
    advisedSectionIds,
  });
}

/** The full verdict against a real section. */
export function destinationVerdict(
  c: TransferCandidate,
  d: TransferDestination,
  advisedSectionIds?: string[]
): TransferVerdict {
  return evaluateSectionTransfer({
    actorSchoolId: SCHOOL,
    learner: learnerFacts(c),
    destination: destinationFacts(d),
    hasPendingRequest: c.pendingRequest,
    advisedSectionIds,
  });
}

/** Short reasons for the dialog's "Left out" list. */
export const LEFT_OUT_LABELS: Record<TransferBlockReason, string> = {
  "learner-unavailable": "Archived",
  floating: "Floating — no grade placement yet",
  "different-grade": "In another grade",
  "section-unavailable": "Section no longer available",
  "no-adviser": "Section has no adviser",
  "moved-since-request": "Moved since the request",
  "not-in-advisory": "Not in your advisory section",
  "pending-request": "A transfer request is already waiting",
};

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
