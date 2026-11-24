import type { ComplianceBaseStatus } from "@prisma/client";
import {
  classifyCompliance,
  type ComplianceFlag,
  type SchoolComplianceFacts,
} from "@/lib/summary/shape/compliance";

/**
 * Status rules for the Full Compliance page
 * (docs/superpowers/specs/2026-11-24-full-compliance-design.md). Pure: the
 * daily recorder stores the base status, and the page derives the shown status
 * from today's facts plus the stored `compliantSince`.
 *
 * "Compliant" is exactly "no flag from `classifyCompliance`", so this page and
 * Non-compliance can never disagree about a school.
 */

export type FullComplianceStatus =
  | "CONSISTENT"
  | "FULL"
  | "NEW"
  | "AT_RISK"
  | "NON_COMPLIANT"
  | "NOT_EVALUATED";

/** In the order the page lists and filters them. */
export const FULL_COMPLIANCE_STATUSES: readonly FullComplianceStatus[] = [
  "CONSISTENT",
  "FULL",
  "NEW",
  "AT_RISK",
  "NON_COMPLIANT",
  "NOT_EVALUATED",
];

export const FULL_COMPLIANCE_STATUS_LABELS: Record<FullComplianceStatus, string> = {
  CONSISTENT: "Consistently compliant",
  FULL: "Fully compliant",
  NEW: "Newly compliant",
  AT_RISK: "At risk",
  NON_COMPLIANT: "Non-compliant",
  NOT_EVALUATED: "Not evaluated",
};

export const FULL_COMPLIANCE_STATUS_DEFINITIONS: Record<FullComplianceStatus, string> = {
  CONSISTENT: "No flags for 30 or more days in a row.",
  FULL: "Complete, up to date and with no discrepancies today.",
  NEW: "Became compliant within the last 7 days.",
  AT_RISK: "No flags today, but attendance was last recorded 10 or more days ago (it is flagged at 14).",
  NON_COMPLIANT: "Has at least one flag on the Non-compliance page.",
  NOT_EVALUATED: "No learners encoded, or no active school year.",
};

/** The statuses that count as compliant (zero flags). */
export const COMPLIANT_STATUSES: ReadonlySet<FullComplianceStatus> = new Set([
  "CONSISTENT",
  "FULL",
  "NEW",
  "AT_RISK",
]);

/** Days in a row with no flags before a school is "consistently" compliant. */
export const CONSISTENT_DAYS = 30;
/** A streak shorter than this, begun after tracking started, is "newly" compliant. */
export const NEW_DAYS = 7;
/** Attendance this many days old is at risk (the flag fires at 14). */
export const AT_RISK_ATTENDANCE_DAYS = 10;

function keyToUtcDay(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Whole calendar days from `from` to `to` (local `YYYY-MM-DD` keys). */
export function daysBetweenKeys(from: string, to: string): number {
  return keyToUtcDay(to) - keyToUtcDay(from);
}

/** Days in the streak, counting both ends; null when there is no streak. */
export function streakDays(compliantSince: string | null, todayKey: string): number | null {
  return compliantSince ? daysBetweenKeys(compliantSince, todayKey) + 1 : null;
}

/** The school's base status today, and its flags. */
export function baseStatusOf(
  facts: SchoolComplianceFacts,
  hasActiveYear: boolean,
  todayKey: string
): { base: ComplianceBaseStatus; flags: ComplianceFlag[] } {
  const { flags } = classifyCompliance(facts, todayKey);
  if (facts.liveLearners === 0 || !hasActiveYear) return { base: "NOT_EVALUATED", flags };
  return { base: flags.length > 0 ? "NON_COMPLIANT" : "COMPLIANT", flags };
}

/**
 * No flag yet, but attendance is close to going stale (ARAL schools only).
 *
 * Attendance is the only record with a grace period: Non-compliance flags it
 * after 14 days. Reading levels and MOSY have none (a month with no reading
 * level, or an open MOSY window with a learner not updated, is flagged on its
 * first day), so they can never put a compliant school "at risk".
 */
export function isAtRisk(facts: SchoolComplianceFacts, todayKey: string): boolean {
  if (facts.aralLearners === 0 || !facts.lastAttendanceKey) return false;
  return daysBetweenKeys(facts.lastAttendanceKey, todayKey) >= AT_RISK_ATTENDANCE_DAYS;
}

/**
 * The status the page shows. First match wins: not evaluated, non-compliant,
 * at risk, newly, consistently, fully. "Newly" needs a streak that began with
 * a recorded change, not on the day tracking started.
 */
export function displayStatus(args: {
  base: ComplianceBaseStatus;
  compliantSince: string | null;
  trackingStart: string | null;
  facts: SchoolComplianceFacts;
  todayKey: string;
}): FullComplianceStatus {
  const { base, compliantSince, trackingStart, facts, todayKey } = args;
  if (base === "NOT_EVALUATED") return "NOT_EVALUATED";
  if (base === "NON_COMPLIANT") return "NON_COMPLIANT";
  if (isAtRisk(facts, todayKey)) return "AT_RISK";
  const streak = streakDays(compliantSince, todayKey) ?? 1;
  if (streak < NEW_DAYS && compliantSince && trackingStart && compliantSince > trackingStart) return "NEW";
  if (streak >= CONSISTENT_DAYS) return "CONSISTENT";
  return "FULL";
}
