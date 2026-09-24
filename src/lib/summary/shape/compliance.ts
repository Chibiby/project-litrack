import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";

/**
 * Every non-compliance definition, in one pure function (spec 4.6, Q8 default).
 *
 * The facts come from one SQL round trip over all schools in scope
 * (`src/lib/summary/queries/compliance.ts`); this decides what they mean. Tests
 * pin one case per definition, so a definition cannot drift silently.
 */
export type SchoolComplianceFacts = {
  /** Live learners (`deletedAt IS NULL`), archived included. */
  liveLearners: number;
  /** Live teachers with `approvalStatus = PENDING`. */
  pendingTeachers: number;
  /** Live, non-FLOATING grades with no live section advised by an active, live teacher. */
  gradesWithoutAdviser: number;
  /** Active-enrolled ARAL learners (the attendance and reading roster). */
  aralLearners: number;
  /**
   * Local `YYYY-MM-DD` of the latest attendance mark, or null for none. The SQL
   * only looks as far back as `recentAttendanceFloorKey`, so null also means
   * "nothing recent".
   */
  lastAttendanceKey: string | null;
  /** Distinct ARAL learners with a reading-level record anchored in the current month. */
  readingLearnersThisMonth: number;
  /** Active-enrolled learners missing nutritional status, or English profile in a grade that collects English. */
  incompleteLearners: number;
  /** Live, non-archived learners. */
  nonArchivedLearners: number;
  /** ACTIVE enrollments in an active school year. */
  activeEnrollments: number;
  /** Learners whose `gradeLevelId` differs from their ACTIVE enrollment's. */
  pointerDrift: number;
  /** Distinct ARAL learners marked in the last full Mon–Fri week (0 = nothing recorded that week). */
  lastWeekMarkedLearners: number;
};

export type ComplianceFlag =
  | "NO_ENCODED_DATA"
  | "PENDING"
  | "NOT_UPDATED"
  | "INCOMPLETE"
  | "DISCREPANCIES";

export const COMPLIANCE_FLAGS: readonly ComplianceFlag[] = [
  "NO_ENCODED_DATA",
  "PENDING",
  "NOT_UPDATED",
  "INCOMPLETE",
  "DISCREPANCIES",
];

export const COMPLIANCE_FLAG_LABELS: Record<ComplianceFlag, string> = {
  NO_ENCODED_DATA: "No encoded data",
  PENDING: "Pending",
  NOT_UPDATED: "Not updated",
  INCOMPLETE: "Incomplete",
  DISCREPANCIES: "Discrepancies",
};

/** How each flag is decided, in words the page and the export print. */
export const COMPLIANCE_FLAG_DEFINITIONS: Record<ComplianceFlag, string> = {
  NO_ENCODED_DATA: "The school has no learners encoded.",
  PENDING:
    "A teacher is waiting for approval, or a grade (other than Floating) has no section with an active adviser.",
  NOT_UPDATED:
    "The school has ARAL learners, and no attendance was recorded in the last 14 days or no reading level was recorded this month.",
  INCOMPLETE:
    "An enrolled learner is missing nutritional status, or an English reading level in a grade that records English.",
  DISCREPANCIES:
    "Learner and enrollment counts differ, a learner's grade differs from their enrollment, or last week's attendance or this month's reading records do not cover the whole ARAL roster.",
};

export type ComplianceReason =
  | "no_learners"
  | "pending_teachers"
  | "grades_without_adviser"
  | "no_recent_attendance"
  | "no_reading_this_month"
  | "incomplete_learners"
  | "enrollment_count_mismatch"
  | "grade_pointer_drift"
  | "attendance_roster_mismatch"
  | "reading_roster_mismatch";

export type ComplianceFlags = {
  flags: ComplianceFlag[];
  reasons: ComplianceReason[];
};

/** Days back an attendance mark still counts as recent. */
export const NOT_UPDATED_ATTENDANCE_DAYS = 14;

/** The earliest local day an attendance mark counts as "in the last 14 days". */
export function recentAttendanceFloorKey(todayKey: string): string {
  return formatLocalDateKey(addDays(parseLocalDateKey(todayKey), -(NOT_UPDATED_ATTENDANCE_DAYS - 1)));
}

export function classifyCompliance(
  facts: SchoolComplianceFacts,
  todayKey: string
): ComplianceFlags {
  const reasons: ComplianceReason[] = [];
  const flags = new Set<ComplianceFlag>();

  if (facts.liveLearners === 0) {
    flags.add("NO_ENCODED_DATA");
    reasons.push("no_learners");
  }

  if (facts.pendingTeachers > 0) {
    flags.add("PENDING");
    reasons.push("pending_teachers");
  }
  if (facts.gradesWithoutAdviser > 0) {
    flags.add("PENDING");
    reasons.push("grades_without_adviser");
  }

  if (facts.aralLearners > 0) {
    const floor = recentAttendanceFloorKey(todayKey);
    if (facts.lastAttendanceKey === null || facts.lastAttendanceKey < floor) {
      flags.add("NOT_UPDATED");
      reasons.push("no_recent_attendance");
    }
    if (facts.readingLearnersThisMonth === 0) {
      flags.add("NOT_UPDATED");
      reasons.push("no_reading_this_month");
    }
  }

  if (facts.incompleteLearners > 0) {
    flags.add("INCOMPLETE");
    reasons.push("incomplete_learners");
  }

  if (facts.nonArchivedLearners !== facts.activeEnrollments) {
    flags.add("DISCREPANCIES");
    reasons.push("enrollment_count_mismatch");
  }
  if (facts.pointerDrift > 0) {
    flags.add("DISCREPANCIES");
    reasons.push("grade_pointer_drift");
  }
  if (facts.lastWeekMarkedLearners > 0 && facts.lastWeekMarkedLearners !== facts.aralLearners) {
    flags.add("DISCREPANCIES");
    reasons.push("attendance_roster_mismatch");
  }
  if (facts.readingLearnersThisMonth > 0 && facts.readingLearnersThisMonth !== facts.aralLearners) {
    flags.add("DISCREPANCIES");
    reasons.push("reading_roster_mismatch");
  }

  return { flags: COMPLIANCE_FLAGS.filter((f) => flags.has(f)), reasons };
}

/** Which flag each reason raises. */
export const COMPLIANCE_REASON_FLAG: Record<ComplianceReason, ComplianceFlag> = {
  no_learners: "NO_ENCODED_DATA",
  pending_teachers: "PENDING",
  grades_without_adviser: "PENDING",
  no_recent_attendance: "NOT_UPDATED",
  no_reading_this_month: "NOT_UPDATED",
  incomplete_learners: "INCOMPLETE",
  enrollment_count_mismatch: "DISCREPANCIES",
  grade_pointer_drift: "DISCREPANCIES",
  attendance_roster_mismatch: "DISCREPANCIES",
  reading_roster_mismatch: "DISCREPANCIES",
};

export const COMPLIANCE_REASON_LABELS: Record<ComplianceReason, string> = {
  no_learners: "No learners encoded",
  pending_teachers: "Teacher awaiting approval",
  grades_without_adviser: "Grade with no active adviser",
  no_recent_attendance: "No attendance in the last 14 days",
  no_reading_this_month: "No reading level this month",
  incomplete_learners: "Learner profile incomplete",
  enrollment_count_mismatch: "Learner and enrollment counts differ",
  grade_pointer_drift: "Learner grade differs from enrollment",
  attendance_roster_mismatch: "Last week's attendance does not cover the ARAL roster",
  reading_roster_mismatch: "This month's reading records do not cover the ARAL roster",
};
