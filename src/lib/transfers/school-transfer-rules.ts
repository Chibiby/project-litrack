import type { SchoolTransferStatus } from "@prisma/client";
import { isAralVolunteerDesignation } from "@/lib/teachers/scope";

/**
 * Pure rules for cross-school transfers
 * (docs/superpowers/specs/2026-11-23-cross-school-transfers-design.md).
 * No Prisma client, no `server-only`: safe for tests and client components.
 */

/** A pending transfer nobody answers cancels itself after this many days. */
export const TRANSFER_EXPIRY_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function expiresAtFor(sentAt: Date): Date {
  return new Date(sentAt.getTime() + TRANSFER_EXPIRY_DAYS * DAY_MS);
}

/**
 * The status a person should see. Expiry is computed at read time: a PENDING
 * row whose `expiresAt` has passed is EXPIRED even before any action stores it.
 */
export function effectiveStatus(
  row: { status: SchoolTransferStatus; expiresAt: Date },
  now: Date
): SchoolTransferStatus {
  if (row.status === "PENDING" && row.expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return row.status;
}

/** The tab a teacher account belongs on. Fixed on the row at send time. */
export function transferKindForTeacher(
  designation: string | null | undefined
): "TEACHER" | "ARAL_VOLUNTEER" {
  return isAralVolunteerDesignation(designation) ? "ARAL_VOLUNTEER" : "TEACHER";
}

/** `School.division` is free text; compare it folded. Blank means not set. */
export function normalizeDivision(division: string | null | undefined): string | null {
  const folded = division?.trim().toLowerCase();
  return folded ? folded : null;
}

type SchoolFacts = { id: string; division: string | null; isActive: boolean };

/** Both schools active, different, and in the same (set) division. */
export function canTransferBetween(from: SchoolFacts, to: SchoolFacts): boolean {
  if (!from.isActive || !to.isActive || from.id === to.id) return false;
  const a = normalizeDivision(from.division);
  return a !== null && a === normalizeDivision(to.division);
}

/** Why one row of an accept or decline was left alone. */
export type SkipReason = "EXPIRED" | "NOT_PENDING" | "MOVED" | "REMOVED";

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  EXPIRED: "Expired before it was answered",
  NOT_PENDING: "Already answered or cancelled",
  MOVED: "No longer at the sending school",
  REMOVED: "Removed or archived at the sending school",
};
