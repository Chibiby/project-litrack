import { ABSENTEEISM_REASON_LABELS } from "@/lib/constants/enum-labels";

/** `""` is No Class — no `Attendance` row at all, not an absence. */
export type CellStatus = "" | "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

export const CELL_LETTER: Record<CellStatus, string> = {
  "": "—",
  PRESENT: "P",
  ABSENT: "A",
  LATE: "L",
  EXCUSED: "E",
};

export const CELL_TONE: Record<CellStatus, string> = {
  "": "border-input bg-background text-muted-foreground",
  PRESENT:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  ABSENT:
    "border-red-300 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  EXCUSED:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  // Legacy only: nothing in the app writes LATE any more, but a stored row must
  // still read back correctly rather than silently displaying as No Class.
  LATE: "border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
};

/** The dot beside each option in the picker. */
export const CELL_DOT: Record<CellStatus, string> = {
  "": "bg-muted-foreground/40 text-white",
  PRESENT: "bg-emerald-500 text-white",
  ABSENT: "bg-red-500 text-white",
  EXCUSED: "bg-amber-500 text-white",
  LATE: "bg-sky-500 text-white",
};

/** The statuses a teacher can pick. LATE is deliberately absent. */
export const PICKABLE: CellStatus[] = ["", "PRESENT", "ABSENT", "EXCUSED"];

export const STATUS_LABEL: Record<CellStatus, string> = {
  "": "No Class",
  PRESENT: "Present",
  ABSENT: "Absent",
  EXCUSED: "Excused",
  LATE: "Late",
};

/**
 * Present needs no reason — that is the rule the picker states out loud, and the
 * server enforces it by storing NULL for a PRESENT cell however the client got
 * there. No Class deletes the row, so it has nowhere to keep one either.
 */
export function statusTakesReason(status: CellStatus): boolean {
  return status === "ABSENT" || status === "EXCUSED";
}

/**
 * The per-day reason list, shared with the ARAL profile's Reasons of
 * Absenteeism so a teacher meets the same wording in both places. The LABEL is
 * what lands in `Attendance.notes`; `parseNote` matches on it, so a note
 * written under an older list reads back under "Other" with its text intact.
 */
export const REASON_OPTIONS: readonly string[] = Object.values(
  ABSENTEEISM_REASON_LABELS
);

/** The picker's free-text escape hatch; never stored as the literal label. */
export const REASON_OTHER = "Other — Please specify";

export const DETAILS_MAX = 200;

/**
 * A stored note is one string, so the picker's two fields are packed into it and
 * unpacked again on load. A known label with details reads `Label — details`;
 * anything unrecognised is treated as free text under `REASON_OTHER`, which is
 * what makes a note written by an older build — a weekly remark, say — survive
 * being opened in the new picker instead of being silently dropped.
 */
export function composeNote(reason: string, details: string): string | null {
  const trimmed = details.trim();
  if (!reason || reason === REASON_OTHER) {
    return trimmed.length > 0 ? trimmed : null;
  }
  return trimmed.length > 0 ? `${reason} — ${trimmed}` : reason;
}

export function parseNote(note: string): { reason: string; details: string } {
  if (!note) return { reason: "", details: "" };
  for (const option of REASON_OPTIONS) {
    if (note === option) return { reason: option, details: "" };
    if (note.startsWith(`${option} — `)) {
      return { reason: option, details: note.slice(option.length + 3) };
    }
  }
  return { reason: REASON_OTHER, details: note };
}

export type WeeklyAttendanceGridLearner = {
  id: string;
  /** Stored Firstname-first name. Kept for anything that speaks the name. */
  fullName: string;
  /** Surname-first display form ("Lastname, Firstname Middlename"), built
   * server-side by `formatListingNameFromRecord`. This is what the Learner
   * column shows and what the panel's "Alphabetical" sort compares. */
  listingName: string;
  sectionName: string | null;
};

export type WeeklyAttendanceGridExisting = {
  learnerId: string;
  dateKey: string;
  status: string;
  notes: string | null;
};

export type RowState = {
  /** Keyed by local `YYYY-MM-DD`. */
  statuses: Record<string, CellStatus>;
  /** The reason for each day, keyed the same way. `""` is no reason. */
  notes: Record<string, string>;
};

export type Day = {
  key: string;
  weekday: string;
  monthDay: string;
  aria: string;
  /** Weekend or grade-level holiday: no mark can be stored here. */
  locked: boolean;
  lockReason: string;
};

export function isCellStatus(value: string): value is Exclude<CellStatus, ""> {
  return (
    value === "PRESENT" ||
    value === "ABSENT" ||
    value === "LATE" ||
    value === "EXCUSED"
  );
}
