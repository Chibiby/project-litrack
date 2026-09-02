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

export type { ReportFormat, ReportKind };

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
};

/** The five cards on the hub, in the order the design lays them out. */
export const REPORT_CARDS: {
  kind: ReportKind;
  title: string;
  blurb: string;
  bullets: string[];
  /** Not yet built: renders inert with a "Soon" pill, as the nav does. */
  soon?: boolean;
}[] = [
  {
    kind: "ATTENDANCE",
    title: "Attendance Records",
    blurb: "Generate detailed attendance logs weekly, monthly or by date range.",
    bullets: ["Daily / Weekly / Monthly", "Absences with reasons", "Summary per learner"],
  },
  {
    kind: "READING_LEVEL",
    title: "Weekly Reading Level",
    blurb: "View and export weekly reading levels of learners.",
    bullets: ["Per week summary", "Reading level per learner", "Progress comparison"],
  },
  {
    kind: "TERM_GRADES",
    title: "End of Term Report (Grades)",
    blurb: "Generate grades per subject for selected term.",
    bullets: ["First / Second / Third Term", "Subject grades summary", "General Average"],
  },
  {
    kind: "TEACHER_SUMMARY",
    title: "Teacher Summary",
    blurb: "Overview of your classes and learner performance.",
    bullets: ["Class performance summary", "Attendance overview", "Reading level insights"],
  },
  {
    kind: "CUSTOM",
    title: "Custom Report",
    blurb: "Create a custom report based on your selected data.",
    bullets: ["Choose data type", "Select fields", "Filter and export"],
    soon: true,
  },
];

/** The one-click chips under Quick Generate. */
export const QUICK_ACTIONS: {
  id: string;
  label: string;
  kind: ReportKind;
  /** Resolved against the school's local today when the chip is pressed. */
  range: "this-week" | "this-month" | "none";
}[] = [
  { id: "week-attendance", label: "This Week Attendance", kind: "ATTENDANCE", range: "this-week" },
  { id: "month-attendance", label: "This Month Attendance", kind: "ATTENDANCE", range: "this-month" },
  { id: "week-reading", label: "This Week Reading Level", kind: "READING_LEVEL", range: "this-week" },
  { id: "term-grades", label: "This Term Grades", kind: "TERM_GRADES", range: "none" },
  { id: "class-roster", label: "Class Roster", kind: "CLASS_ROSTER", range: "none" },
];
