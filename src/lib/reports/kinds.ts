/**
 * Shared vocabulary for the Reports Hub.
 *
 * Pure and client-safe on purpose: the hub's cards, tabs and Recent Reports
 * table all need these labels, and importing them from the `"use server"`
 * actions module would drag Prisma into the client bundle and into every
 * component test (see `@/lib/search/global` for the same split, and the header
 * search test that died before it).
 */

import type { ReportFormat, ReportKind } from "@prisma/client";
import type { ReportPurpose } from "@/lib/reports/report-frame";

export type { ReportFormat, ReportKind, ReportPurpose };

// The labels themselves live with every other enum's, per the repo rule that
// adding an enum value means updating `enum-labels.ts` too. Re-exported here so
// the hub has one import.
export {
  REPORT_KIND_LABELS,
  REPORT_FORMAT_LABELS,
} from "@/lib/constants/enum-labels";

export const REPORT_FORMAT_EXTENSION: Record<ReportFormat, string> = {
  EXCEL: "xlsx",
  PDF: "pdf",
};

/**
 * Every filter the hub can apply. All optional: a report with none of them set
 * is the widest report that role is allowed to run, and each field narrows it.
 *
 * Dates are local `YYYY-MM-DD` keys, never `Date`. The school runs at UTC+8 and
 * a serialized `Date` names the previous day between 00:00 and 08:00 Manila —
 * the same rule the attendance grid follows (`src/lib/date-keys.ts`).
 */
export type ReportFilters = {
  schoolYearId?: string | null;
  gradeLevelId?: string | null;
  sectionId?: string | null;
  /** Inclusive local date key. */
  from?: string | null;
  /** Inclusive local date key. */
  to?: string | null;
  term?: string | null;
  /**
   * PRINT (the full template, default) or RECORDS (a plain data sheet).
   * Stored with the filters on the history row so Re-generate replays it; a
   * row saved before this field existed has none and replays as PRINT.
   */
  purpose?: ReportPurpose | null;
};

/**
 * The periods a report's Export control can offer. `school-year` sends no
 * dates, which every dated builder reads as "the school year to date".
 */
export type ReportPeriodId = "this-week" | "this-month" | "school-year" | "custom";

export const REPORT_PERIOD_LABELS: Record<ReportPeriodId, string> = {
  "this-week": "This week",
  "this-month": "This month",
  "school-year": "School year",
  custom: "Custom dates",
};

export type ReportCard = {
  kind: ReportKind;
  title: string;
  /** One sentence: what is in the file. */
  blurb: string;
  /**
   * The periods this report can be cut to, the first one preselected. Empty
   * for a report that has no dates (grades, roster), so its Export control
   * shows no period at all rather than one that does nothing.
   */
  periods: ReportPeriodId[];
};

/**
 * The reports on the page, most used first. MOSY has no card: it is exported
 * from its own page (`/teacher/aral/mosy`). The `MOSY` kind, its builder and
 * its validator entry stay so a Recent downloads row of that kind can still be
 * downloaded again. `CUSTOM` was never built and has no card either.
 */
export const REPORT_CARDS: ReportCard[] = [
  {
    kind: "ATTENDANCE",
    title: "Attendance",
    blurb: "ARAL attendance for every school day, with totals per learner. One sheet per month.",
    periods: ["this-month", "this-week", "school-year", "custom"],
  },
  {
    kind: "READING_LEVEL",
    title: "Monthly Reading Level",
    blurb: "Each ARAL learner's reading level, month by month.",
    periods: ["school-year", "this-month", "custom"],
  },
  {
    kind: "TERM_GRADES",
    title: "End of Term Grades",
    blurb: "Grades per subject and the general average, for each term.",
    periods: [],
  },
  {
    kind: "CLASS_ROSTER",
    title: "Class Roster",
    blurb: "Every learner in the class, with grade, section and gender.",
    periods: [],
  },
  {
    kind: "TEACHER_SUMMARY",
    title: "Class Summary",
    blurb: "One row per section: learners, attendance and reading levels.",
    periods: ["school-year", "this-month", "custom"],
  },
];
