import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import type { FacetResult } from "@/lib/summary/types";

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
  /**
   * MOSY facts for the active school year, or null when MOSY is not due yet:
   * the school has no active year, or today is before the MOSY (Second Term)
   * window starts.
   */
  mosy: {
    /** ARAL learners with no MOSY row this school year (no level saved). */
    notUpdated: number;
    /** ARAL learners whose level is saved but who still wait for a stay or move-out decision. */
    forDecision: number;
  } | null;
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
    "A teacher is waiting for approval, a grade (other than Floating) has no section with an active adviser, or an ARAL learner's MOSY level is saved but the stay or move-out decision is not.",
  NOT_UPDATED:
    "The school has ARAL learners, and no attendance was recorded in the last 14 days, no reading level was recorded this month, or (once the MOSY window has started) an ARAL learner has no MOSY update.",
  INCOMPLETE:
    "An enrolled learner is missing nutritional status, or an English reading level in a grade that records English.",
  DISCREPANCIES:
    "Learner and enrollment counts differ, a learner's grade differs from their enrollment, or last week's attendance or this month's reading records do not cover the whole ARAL roster.",
};

export type ComplianceReason =
  | "no_learners"
  | "pending_teachers"
  | "grades_without_adviser"
  | "mosy_for_decision"
  | "no_recent_attendance"
  | "mosy_not_updated"
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
  if (facts.mosy && facts.mosy.forDecision > 0) {
    flags.add("PENDING");
    reasons.push("mosy_for_decision");
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
  if (facts.mosy && facts.mosy.notUpdated > 0) {
    flags.add("NOT_UPDATED");
    reasons.push("mosy_not_updated");
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
  mosy_for_decision: "PENDING",
  no_recent_attendance: "NOT_UPDATED",
  no_reading_this_month: "NOT_UPDATED",
  mosy_not_updated: "NOT_UPDATED",
  incomplete_learners: "INCOMPLETE",
  enrollment_count_mismatch: "DISCREPANCIES",
  grade_pointer_drift: "DISCREPANCIES",
  attendance_roster_mismatch: "DISCREPANCIES",
  reading_roster_mismatch: "DISCREPANCIES",
};

/**
 * Every list the compliance page/export can show, in the order the page
 * lists them: each flag, then "Schools with no district admin". Drives the
 * Flag filter (`?flag=`) on both the Super Admin and District Admin pages,
 * and the same param on export — the id doubles as `SummaryList.id` in
 * `shapeCompliance` below, so filtering a `FacetResult` is just an id match.
 */
export const COMPLIANCE_FLAG_FILTER_IDS = [
  "NO_ENCODED_DATA",
  "PENDING",
  "NOT_UPDATED",
  "INCOMPLETE",
  "DISCREPANCIES",
  "noDistrictAdmin",
] as const;

export type ComplianceFlagFilter = (typeof COMPLIANCE_FLAG_FILTER_IDS)[number];

export const COMPLIANCE_FLAG_FILTER_LABELS: Record<ComplianceFlagFilter, string> = {
  ...COMPLIANCE_FLAG_LABELS,
  noDistrictAdmin: "Schools with no district admin",
};

export function isComplianceFlagFilter(value: unknown): value is ComplianceFlagFilter {
  return (
    typeof value === "string" &&
    (COMPLIANCE_FLAG_FILTER_IDS as readonly string[]).includes(value)
  );
}

/** A raw `?flag=` value, or null when absent or unknown (shows "All flags"). */
export function parseComplianceFlagParam(raw: string | string[] | undefined | null): ComplianceFlagFilter | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return isComplianceFlagFilter(value) ? value : null;
}

export const COMPLIANCE_REASON_LABELS: Record<ComplianceReason, string> = {
  no_learners: "No learners encoded",
  pending_teachers: "Teacher awaiting approval",
  grades_without_adviser: "Grade with no active adviser",
  mosy_for_decision: "MOSY decision not made",
  no_recent_attendance: "No attendance in the last 14 days",
  no_reading_this_month: "No reading level this month",
  mosy_not_updated: "MOSY not updated",
  incomplete_learners: "Learner profile incomplete",
  enrollment_count_mismatch: "Learner and enrollment counts differ",
  grade_pointer_drift: "Learner grade differs from enrollment",
  attendance_roster_mismatch: "Last week's attendance does not cover the ARAL roster",
  reading_roster_mismatch: "This month's reading records do not cover the ARAL roster",
};

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * One reason in words with the school's own numbers, e.g. "2 teachers awaiting
 * approval" — what the table cells and the lists' "Why" column print, so a
 * reader sees what to fix without opening the school.
 */
export function describeComplianceReason(
  reason: ComplianceReason,
  facts: SchoolComplianceFacts
): string {
  switch (reason) {
    case "no_learners":
      return "No learners encoded";
    case "pending_teachers":
      return `${plural(facts.pendingTeachers, "teacher", "teachers")} awaiting approval`;
    case "grades_without_adviser":
      return `${plural(facts.gradesWithoutAdviser, "grade has", "grades have")} no active adviser`;
    case "mosy_for_decision":
      return `${plural(facts.mosy?.forDecision ?? 0, "ARAL learner waits", "ARAL learners wait")} for a MOSY stay or move-out decision`;
    case "no_recent_attendance":
      return facts.lastAttendanceKey
        ? `No ARAL attendance since ${facts.lastAttendanceKey}`
        : `No ARAL attendance in the last ${NOT_UPDATED_ATTENDANCE_DAYS} days`;
    case "no_reading_this_month":
      return `No reading level recorded this month for ${plural(facts.aralLearners, "ARAL learner", "ARAL learners")}`;
    case "mosy_not_updated":
      return `${plural(facts.mosy?.notUpdated ?? 0, "ARAL learner has", "ARAL learners have")} no MOSY update`;
    case "incomplete_learners":
      return `${plural(facts.incompleteLearners, "learner is", "learners are")} missing nutritional status or English reading level`;
    case "enrollment_count_mismatch":
      return `${plural(facts.nonArchivedLearners, "learner", "learners")} but ${plural(facts.activeEnrollments, "active enrollment", "active enrollments")}`;
    case "grade_pointer_drift":
      return `${plural(facts.pointerDrift, "learner's grade differs", "learners' grades differ")} from their enrollment`;
    case "attendance_roster_mismatch":
      return `Last week's attendance covers ${facts.lastWeekMarkedLearners} of ${plural(facts.aralLearners, "ARAL learner", "ARAL learners")}`;
    case "reading_roster_mismatch":
      return `This month's reading levels cover ${facts.readingLearnersThisMonth} of ${plural(facts.aralLearners, "ARAL learner", "ARAL learners")}`;
  }
}

/**
 * Narrow a compliance `FacetResult` to one flag's list, for the page's Flag
 * filter. The "Schools flagged" overview section is left as-is — only the
 * lists narrow — so `null` (All flags) is a no-op.
 */
export function filterComplianceResult(
  result: FacetResult,
  flag: ComplianceFlagFilter | null
): FacetResult {
  if (!flag) return result;
  const list = result.lists.find((l) => l.id === flag);
  return { ...result, lists: list ? [list] : [] };
}

/**
 * Same narrowing, for export: the file holds only the chosen list, so the
 * overview section is dropped too (spec: "the report table contains only
 * that list's rows").
 */
export function filterComplianceResultForExport(
  result: FacetResult,
  flag: ComplianceFlagFilter | null
): FacetResult {
  if (!flag) return result;
  const filtered = filterComplianceResult(result, flag);
  // The file stands alone, so its summary must describe only this list: the
  // count is the listed schools, and the only note is this flag's rule — not
  // the whole-report notes about percentages and overlapping flags.
  const definition =
    flag === "noDistrictAdmin"
      ? "No district admin is assigned to the school's district, or the school has no district."
      : COMPLIANCE_FLAG_DEFINITIONS[flag];
  // The flagged-schools export list narrows to the same schools; it has no
  // meaning for the no-district-admin list, which is not a flag.
  const exportList = result.exportList;
  const keep = new Set(filtered.lists[0]?.rows.map((r) => r[1]));
  const narrowed =
    exportList && flag !== "noDistrictAdmin"
      ? { exportList: { ...exportList, note: undefined, rows: exportList.rows.filter((r) => keep.has(r[1])) } }
      : {};
  const { exportList: _dropped, ...rest } = filtered;
  void _dropped;
  return {
    ...rest,
    ...narrowed,
    sections: [],
    schoolCount: filtered.lists[0]?.rows.length ?? 0,
    notes: [`${COMPLIANCE_FLAG_FILTER_LABELS[flag]}: ${definition}`, "Inactive schools are not included."],
  };
}

/** `NO_ENCODED_DATA` -> `no-encoded-data`, `noDistrictAdmin` -> `no-district-admin` (export filename). */
export function complianceFlagSlug(flag: ComplianceFlagFilter): string {
  return flag
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase();
}
