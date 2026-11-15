/**
 * Teacher Tasks — the pure rules.
 *
 * Which period each task is checked against, whether a task applies to a
 * teacher, and what state it is in, all decided from plain facts. No Prisma
 * runtime and no `server-only`: `queries.ts` gathers the facts for a whole
 * school in a bounded number of queries and hands them here, and the unit tests
 * hand in literals.
 *
 * Dates are local `YYYY-MM-DD` keys throughout (`src/lib/date-keys.ts`).
 * String comparison on those keys is date order, so no `Date` arithmetic
 * decides a boundary here except week stepping, which goes through `addDays`.
 */
import type { AdvisoryMode } from "@prisma/client";
import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { attendanceDeadline } from "@/lib/week-range";
import { readingLevelDeadline } from "@/lib/month-range";
import { resolveMosyWindow } from "@/lib/reports/mosy-window";
import {
  getTermWindows,
  type TermPeriodValue,
  type TermWindowOverrideInput,
} from "@/lib/terms/windows";
import { advisoryRosterDenial } from "@/lib/teachers/scope";
import { mosyRowStatus } from "@/lib/aral/mosy";
import {
  TEACHER_TASK_KINDS,
  TEACHER_TASK_LABELS,
  isTeacherTaskKind,
  type TaskStatus,
  type TeacherTaskKind,
  type TeacherTaskRow,
  type TeacherTaskSummary,
} from "@/lib/teacher-tasks/types";

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/**
 * Hardcoded rather than `Intl`, like `src/lib/week-range.ts`: these labels
 * render on the server and hydrate in the browser, and the two do not always
 * ship the same ICU data.
 */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));

function keyParts(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

/** "October 2026" for a `YYYY-MM` key. */
export function formatMonthKeyLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTHS[m! - 1]} ${y}`;
}

/**
 * "Oct 5–9, 2026", "Sep 28 – Oct 2, 2026", or "Dec 28, 2026 – Jan 1, 2027".
 * En dashes; the year appears once unless the range straddles New Year.
 */
export function formatShortDateRange(startKey: string, endKey: string): string {
  const a = keyParts(startKey);
  const b = keyParts(endKey);
  if (a.y !== b.y) {
    return `${SHORT_MONTHS[a.m - 1]} ${a.d}, ${a.y} – ${SHORT_MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  }
  if (a.m !== b.m) {
    return `${SHORT_MONTHS[a.m - 1]} ${a.d} – ${SHORT_MONTHS[b.m - 1]} ${b.d}, ${b.y}`;
  }
  return `${SHORT_MONTHS[a.m - 1]} ${a.d}–${b.d}, ${b.y}`;
}

/** Monday key of the Monday-to-Sunday week `key` falls in. */
export function mondayKeyOf(key: string): string {
  const date = parseLocalDateKey(key);
  const offset = (date.getDay() + 6) % 7; // 0 = Monday
  return formatLocalDateKey(addDays(date, -offset));
}

/**
 * `SchoolYear.startDate` as a `YYYY-MM-DD` key.
 *
 * Read with UTC getters, exactly as `getTermWindows` reads it: the column holds
 * the UTC midnight of the day typed into the school-year form
 * (`src/lib/terms/windows.ts` explains why). Local getters would land on the
 * previous day at any negative offset.
 */
export function schoolYearStartKey(startDate: Date): string {
  const y = startDate.getUTCFullYear();
  const m = String(startDate.getUTCMonth() + 1).padStart(2, "0");
  const d = String(startDate.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * UTC offset of `SCHOOL_TIME_ZONE` (Asia/Manila). The Philippines has kept
 * UTC+8 without daylight saving since 1978, so a fixed offset is exact.
 */
const SCHOOL_UTC_OFFSET = "+08:00";

/**
 * The instant the school-local day `todayKey` began — the lower bound for
 * "already reminded today". A real instant, compared against `createdAt`
 * (`timestamptz`), so it must not be built from the server's local midnight.
 */
export function schoolDayStartInstant(todayKey: string): Date {
  return new Date(`${todayKey}T00:00:00${SCHOOL_UTC_OFFSET}`);
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

/** The active school year, as the rules need it. `null` = the school has none. */
export type ActiveYearInput = {
  startDate: Date;
  overrides: TermWindowOverrideInput[];
} | null;

export type TeacherTaskPeriods = {
  todayKey: string;
  hasActiveYear: boolean;
  /** Active year's first day, or null with no active year. */
  yearStartKey: string | null;
  attendance: {
    mondayKey: string;
    fridayKey: string;
    /** Monday to Friday keys of the due week. */
    dayKeys: string[];
    /** "Sep 28 – Oct 2, 2026" */
    label: string;
    /** The due week ended before the active year began. */
    beforeYearStart: boolean;
  };
  reading: {
    /** `YYYY-MM` of the previous calendar month. */
    monthKey: string;
    /** First day of that month. */
    startKey: string;
    /** First day of the month after (exclusive upper bound). */
    endExclusiveKey: string;
    /** "September 2026" */
    label: string;
    /** That month ended before the active year began. */
    beforeYearStart: boolean;
  };
  /** Null with no active year. */
  mosy: { startKey: string; windowLabel: string; started: boolean } | null;
  /** The latest term whose deadline is before today; null when none has ended or no active year. */
  endOfTerm: { term: TermPeriodValue; label: string; rangeLabel: string } | null;
};

/**
 * The attendance week a teacher is held to on `todayKey`: the most recent
 * Monday-to-Friday week whose editing deadline (`attendanceDeadline`, Sunday
 * plus the grace days) is strictly before today. Weeks still inside their grace
 * period are still the teacher's to finish, so they are not counted yet.
 */
export function dueAttendanceWeek(todayKey: string): { mondayKey: string; fridayKey: string } {
  let monday = parseLocalDateKey(mondayKeyOf(todayKey));
  // A few steps back at most: a week's deadline is its Sunday plus the grace days.
  while (formatLocalDateKey(attendanceDeadline(monday)) >= todayKey) {
    monday = addDays(monday, -7);
  }
  return {
    mondayKey: formatLocalDateKey(monday),
    fridayKey: formatLocalDateKey(addDays(monday, 4)),
  };
}

/** `YYYY-MM` of the calendar month before `todayKey`'s. */
export function previousMonthKey(todayKey: string): string {
  const { y, m } = keyParts(todayKey);
  const index = y * 12 + (m - 1) - 1;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function nextMonthStartKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  const index = y! * 12 + (m! - 1) + 1;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01`;
}

export function resolveTeacherTaskPeriods(
  todayKey: string,
  activeYear: ActiveYearInput
): TeacherTaskPeriods {
  const yearStartKey = activeYear ? schoolYearStartKey(activeYear.startDate) : null;

  const week = dueAttendanceWeek(todayKey);
  const dayKeys = [0, 1, 2, 3, 4].map((i) =>
    formatLocalDateKey(addDays(parseLocalDateKey(week.mondayKey), i))
  );

  // The latest month whose reading-level deadline (month end plus the grace
  // days) has passed. A month still inside its grace period is not owed yet.
  let monthKey = previousMonthKey(todayKey);
  if (formatLocalDateKey(readingLevelDeadline(monthKey)) >= todayKey) {
    monthKey = previousMonthKey(`${monthKey}-01`);
  }
  const endExclusiveKey = nextMonthStartKey(monthKey);
  const monthLastKey = formatLocalDateKey(addDays(parseLocalDateKey(endExclusiveKey), -1));

  let mosy: TeacherTaskPeriods["mosy"] = null;
  let endOfTerm: TeacherTaskPeriods["endOfTerm"] = null;
  if (activeYear) {
    const window = resolveMosyWindow(activeYear.startDate, activeYear.overrides);
    mosy = { startKey: window.startKey, windowLabel: window.label, started: todayKey >= window.startKey };

    const ended = getTermWindows(activeYear.startDate, activeYear.overrides).filter(
      (w) => w.deadlineKey < todayKey
    );
    const latest = ended[ended.length - 1];
    if (latest) {
      endOfTerm = { term: latest.term, label: latest.label, rangeLabel: latest.rangeLabel };
    }
  }

  return {
    todayKey,
    hasActiveYear: activeYear !== null,
    yearStartKey,
    attendance: {
      ...week,
      dayKeys,
      label: formatShortDateRange(week.mondayKey, week.fridayKey),
      beforeYearStart: yearStartKey !== null && week.fridayKey < yearStartKey,
    },
    reading: {
      monthKey,
      startKey: `${monthKey}-01`,
      endExclusiveKey,
      label: formatMonthKeyLabel(monthKey),
      beforeYearStart: yearStartKey !== null && monthLastKey < yearStartKey,
    },
    mosy,
    endOfTerm,
  };
}

export const NO_ACTIVE_YEAR = "No active school year";

/** The period line each column header shows. */
export function periodLabels(periods: TeacherTaskPeriods): Record<TeacherTaskKind, string> {
  return {
    MOSY: periods.mosy ? `Second Term (${periods.mosy.windowLabel})` : NO_ACTIVE_YEAR,
    READING_LEVEL: periods.reading.label,
    ATTENDANCE: periods.attendance.label,
    ARAL_PROFILING: "No deadline",
    END_OF_TERM: periods.hasActiveYear
      ? periods.endOfTerm
        ? `${periods.endOfTerm.label} (${periods.endOfTerm.rangeLabel})`
        : "No term has ended yet"
      : NO_ACTIVE_YEAR,
  };
}

// ---------------------------------------------------------------------------
// Fact helpers (pure, used by queries.ts on in-memory rows)
// ---------------------------------------------------------------------------

/**
 * True when every school day of the due week is a holiday for every grade the
 * teacher's ARAL learners are in. A teacher with no grades is not on holiday.
 */
export function isHolidayWeek(
  dayKeys: readonly string[],
  gradeLevelIds: readonly string[],
  holidayKeysByGrade: Readonly<Record<string, readonly string[]>>
): boolean {
  if (gradeLevelIds.length === 0) return false;
  return gradeLevelIds.every((gradeId) => {
    const holidays = holidayKeysByGrade[gradeId] ?? [];
    return dayKeys.every((day) => holidays.includes(day));
  });
}

/**
 * MOSY learners whose row is finished: a STAY, or a MOVE_OUT on a learner no
 * longer tagged ARAL. No row, a row with no decision, or a MOVE_OUT on a learner
 * who is tagged again is not finished (`mosyRowStatus`).
 */
export function countMosyDone(
  learners: readonly { isAralLearner: boolean; decision: "STAY" | "MOVE_OUT" | null; hasRow: boolean }[]
): number {
  let done = 0;
  for (const l of learners) {
    const status = mosyRowStatus({
      isAralLearner: l.isAralLearner,
      row: l.hasRow ? { decision: l.decision } : null,
    });
    if (status === "stay" || status === "moved_out") done += 1;
  }
  return done;
}

/** Grade types with an End of Terms subject sheet. Kindergarten uses the competency checklist. */
const END_OF_TERM_EXCLUDED_GRADE_TYPES = new Set(["KINDER", "FLOATING"]);

export type EndOfTermSectionScope<S> = {
  /** Sections the End-of-term check covers. */
  included: S[];
  /** Why nothing is included; null when something is. */
  excludedReason: "NO_SECTIONS" | "KINDER" | "NO_SUBJECTS" | null;
};

/**
 * Which advisory sections the End-of-term check covers: not Kindergarten (its
 * report is the competency checklist, not a subject sheet) and not a grade with
 * no active subjects (nothing to encode — not the teacher's fault).
 */
export function resolveEndOfTermSections<S extends { gradeLevelId: string; gradeType: string }>(
  sections: readonly S[],
  activeSubjectCountByGrade: Readonly<Record<string, number>>
): EndOfTermSectionScope<S> {
  if (sections.length === 0) return { included: [], excludedReason: "NO_SECTIONS" };
  const sheetSections = sections.filter((s) => !END_OF_TERM_EXCLUDED_GRADE_TYPES.has(s.gradeType));
  if (sheetSections.length === 0) return { included: [], excludedReason: "KINDER" };
  const included = sheetSections.filter((s) => (activeSubjectCountByGrade[s.gradeLevelId] ?? 0) > 0);
  if (included.length === 0) return { included: [], excludedReason: "NO_SUBJECTS" };
  return { included, excludedReason: null };
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/** Everything the rules need to know about one teacher. Plain data. */
export type TeacherTaskFacts = {
  teacherId: string;
  name: string;
  /** `TeacherProfile.designation`; null with no profile yet. */
  designation: string | null;
  /** `TeacherProfile.advisoryMode`; null with no profile yet. */
  advisoryMode: AdvisoryMode | null;
  /** Live advisory sections (`Section.adviserId`). */
  advisorySections: { id: string; label: string }[];
  aral: {
    /** Live, non-archived ARAL learners this teacher is the designated tutor of. */
    tutored: number;
    /** Distinct grades of those learners. */
    gradeLevelIds: string[];
    /** At least one Attendance row in the due week for any of them. */
    attendanceRecorded: boolean;
    /** Of `tutored`, learners with a complete assessment in the reading month. */
    readingComplete: number;
    /** Of `tutored`, learners with an ARAL profile. */
    profiled: number;
  };
  mosy: {
    /** Learners in the MOSY scope of the advisory sections (`mosyLearnerScope`). */
    scoped: number;
    /** Of `scoped`, learners whose MOSY row is finished (`countMosyDone`). */
    done: number;
  };
  endOfTerm: {
    excludedReason: EndOfTermSectionScope<unknown>["excludedReason"];
    /** Learners in the included sections. */
    learners: number;
    /** Of `learners`, those with every active subject graded (`computeSheetStats`). */
    complete: number;
  };
};

export type ClassifyContext = {
  periods: TeacherTaskPeriods;
  /** Holiday date keys of the due attendance week, per grade id. */
  holidayKeysByGrade: Readonly<Record<string, readonly string[]>>;
};

const NO_ARAL_LEARNERS = "No ARAL learners";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function counted(
  kind: TeacherTaskKind,
  total: number,
  done: number,
  doneDetail: string,
  pendingDetail: (missing: number) => string
): TaskStatus {
  const missing = Math.max(0, total - done);
  return missing === 0
    ? { kind, state: "DONE", missing: 0, total, detail: doneDetail }
    : { kind, state: "PENDING", missing, total, detail: pendingDetail(missing) };
}

function notApplicable(kind: TeacherTaskKind, detail: string): TaskStatus {
  return { kind, state: "NOT_APPLICABLE", detail };
}

/** "3 of 25 learners have" / "1 of 1 learner has". */
function missingOf(missing: number, total: number, noun: string): string {
  return `${missing} of ${plural(total, noun)} ${missing === 1 ? "has" : "have"}`;
}

/** "All 25 learners have" / "The 1 learner has". */
function allOf(total: number, noun: string): string {
  return total === 1 ? `The 1 ${noun} has` : `All ${total} ${noun}s have`;
}

/**
 * Why the adviser tasks (MOSY, End-of-term) do not apply, or null when they do.
 * Same guards as `resolveMosyAccess` / the End of Terms sheet:
 * `advisoryRosterDenial` (Non-DepEd ARAL Volunteer, Floating), then at least one
 * live advisory section.
 */
export function adviserTaskDenial(facts: Pick<TeacherTaskFacts, "designation" | "advisoryMode" | "advisorySections">): string | null {
  const denial = advisoryRosterDenial({
    isSuperAdmin: false,
    designation: facts.designation,
    advisoryMode: facts.advisoryMode,
  });
  if (denial === "volunteer") return "ARAL Volunteer — not an adviser";
  if (denial === "floating") return "Floating teacher — no advisory section";
  if (facts.advisorySections.length === 0) return "No advisory section";
  return null;
}

function classifyAttendance(facts: TeacherTaskFacts, ctx: ClassifyContext): TaskStatus {
  const { periods } = ctx;
  const week = periods.attendance;
  if (facts.aral.tutored === 0) return notApplicable("ATTENDANCE", NO_ARAL_LEARNERS);
  if (!periods.hasActiveYear) return notApplicable("ATTENDANCE", NO_ACTIVE_YEAR);
  if (week.beforeYearStart) {
    return notApplicable("ATTENDANCE", `${week.label} is before the school year started`);
  }
  if (isHolidayWeek(week.dayKeys, facts.aral.gradeLevelIds, ctx.holidayKeysByGrade)) {
    return notApplicable("ATTENDANCE", `${week.label} was a holiday week`);
  }
  return facts.aral.attendanceRecorded
    ? { kind: "ATTENDANCE", state: "DONE", detail: `Attendance recorded for ${week.label}` }
    : { kind: "ATTENDANCE", state: "PENDING", detail: `No attendance recorded for ${week.label}` };
}

function classifyReading(facts: TeacherTaskFacts, ctx: ClassifyContext): TaskStatus {
  const month = ctx.periods.reading;
  const total = facts.aral.tutored;
  if (total === 0) return notApplicable("READING_LEVEL", NO_ARAL_LEARNERS);
  if (!ctx.periods.hasActiveYear) return notApplicable("READING_LEVEL", NO_ACTIVE_YEAR);
  if (month.beforeYearStart) {
    return notApplicable("READING_LEVEL", `${month.label} is before the school year started`);
  }
  return counted(
    "READING_LEVEL",
    total,
    facts.aral.readingComplete,
    `${allOf(total, "learner")} a reading level for ${month.label}`,
    (missing) => `${missingOf(missing, total, "learner")} no reading level for ${month.label}`
  );
}

function classifyProfiling(facts: TeacherTaskFacts): TaskStatus {
  const total = facts.aral.tutored;
  if (total === 0) return notApplicable("ARAL_PROFILING", NO_ARAL_LEARNERS);
  return counted(
    "ARAL_PROFILING",
    total,
    facts.aral.profiled,
    `${allOf(total, "ARAL learner")} an ARAL profile`,
    (missing) => `${missingOf(missing, total, "ARAL learner")} no ARAL profile`
  );
}

function classifyMosy(facts: TeacherTaskFacts, ctx: ClassifyContext, denial: string | null): TaskStatus {
  if (denial) return notApplicable("MOSY", denial);
  const mosy = ctx.periods.mosy;
  if (!mosy) return notApplicable("MOSY", NO_ACTIVE_YEAR);
  if (!mosy.started) return notApplicable("MOSY", "Second Term has not started");
  const total = facts.mosy.scoped;
  if (total === 0) return notApplicable("MOSY", "No ARAL learners in advisory sections");
  return counted(
    "MOSY",
    total,
    facts.mosy.done,
    `${allOf(total, "learner")} a MOSY decision`,
    (missing) => `${missingOf(missing, total, "learner")} no MOSY decision`
  );
}

function classifyEndOfTerm(facts: TeacherTaskFacts, ctx: ClassifyContext, denial: string | null): TaskStatus {
  if (denial) return notApplicable("END_OF_TERM", denial);
  if (!ctx.periods.hasActiveYear) return notApplicable("END_OF_TERM", NO_ACTIVE_YEAR);
  const term = ctx.periods.endOfTerm;
  if (!term) return notApplicable("END_OF_TERM", "No term has ended yet");
  const { excludedReason, learners, complete } = facts.endOfTerm;
  if (excludedReason === "NO_SECTIONS") return notApplicable("END_OF_TERM", "No advisory section");
  if (excludedReason === "KINDER") return notApplicable("END_OF_TERM", "Kindergarten — not tracked");
  if (excludedReason === "NO_SUBJECTS") {
    return notApplicable("END_OF_TERM", "No subjects set for the advisory grade");
  }
  if (learners === 0) return notApplicable("END_OF_TERM", "No learners in advisory sections");
  return counted(
    "END_OF_TERM",
    learners,
    complete,
    `${allOf(learners, "learner")} ${term.label} grades`,
    (missing) =>
      `${missing} of ${plural(learners, "learner")} ${missing === 1 ? "is" : "are"} missing ${term.label} grades`
  );
}

/** Every task's status for one teacher, plus the pending kinds in display order. */
export function classifyTeacherTasks(
  facts: TeacherTaskFacts,
  ctx: ClassifyContext
): { tasks: Record<TeacherTaskKind, TaskStatus>; pendingKinds: TeacherTaskKind[] } {
  const denial = adviserTaskDenial(facts);
  const tasks: Record<TeacherTaskKind, TaskStatus> = {
    MOSY: classifyMosy(facts, ctx, denial),
    READING_LEVEL: classifyReading(facts, ctx),
    ATTENDANCE: classifyAttendance(facts, ctx),
    ARAL_PROFILING: classifyProfiling(facts),
    END_OF_TERM: classifyEndOfTerm(facts, ctx, denial),
  };
  const pendingKinds = TEACHER_TASK_KINDS.filter((k) => tasks[k].state === "PENDING");
  return { tasks, pendingKinds };
}

/** Rows plus the headline counts. `remindedToday` is whatever the rows carry. */
export function buildTeacherTaskSummary(
  periods: TeacherTaskPeriods,
  rows: TeacherTaskRow[]
): TeacherTaskSummary {
  const pendingByKind = Object.fromEntries(TEACHER_TASK_KINDS.map((k) => [k, 0])) as Record<
    TeacherTaskKind,
    number
  >;
  let teachersWithPending = 0;
  for (const row of rows) {
    if (row.pendingKinds.length > 0) teachersWithPending += 1;
    for (const kind of row.pendingKinds) pendingByKind[kind] += 1;
  }
  return {
    todayKey: periods.todayKey,
    periods: periodLabels(periods),
    rows,
    teachersWithPending,
    pendingByKind,
  };
}

/** The summary with `remindedToday` set from a fresh read of today's reminders. */
export function applyRemindedToday(
  summary: TeacherTaskSummary,
  remindedTeacherIds: ReadonlySet<string>
): TeacherTaskSummary {
  return {
    ...summary,
    rows: summary.rows.map((row) => ({ ...row, remindedToday: remindedTeacherIds.has(row.teacherId) })),
  };
}

// ---------------------------------------------------------------------------
// Export and reminder text
// ---------------------------------------------------------------------------

/** `sendTeacherTaskReminder` refusals. Here, not in the `"use server"` file, which may export only async functions. */
export const ALREADY_REMINDED_MESSAGE =
  "Already reminded today. You can send another reminder tomorrow.";
export const NO_PENDING_TASKS_MESSAGE = "This teacher has no pending tasks.";

/**
 * Rows an export carries. `kind` narrows to teachers pending on that task when
 * `onlyPending` is set; `onlyPending` alone keeps teachers with any pending task.
 */
export function filterTeacherTaskRows(
  rows: readonly TeacherTaskRow[],
  filter: { onlyPending: boolean; kind: TeacherTaskKind | null }
): TeacherTaskRow[] {
  if (!filter.onlyPending) return [...rows];
  return rows.filter((row) =>
    filter.kind ? row.pendingKinds.includes(filter.kind) : row.pendingKinds.length > 0
  );
}

/**
 * The bell sentence for a TASK_REMINDER row, composed at read time:
 * "Your School Head reminded you to finish: Attendance, Reading level."
 *
 * Unknown strings in `reminderTasks` (a kind renamed or removed since the row
 * was written) are skipped; with none left the sentence stays general. Kinds
 * are listed in display order, each once.
 */
export function describeTaskReminder(reminderTasks: readonly string[]): string {
  const known = TEACHER_TASK_KINDS.filter((k) => reminderTasks.some((t) => isTeacherTaskKind(t) && t === k));
  if (known.length === 0) return "Your School Head reminded you to finish your pending tasks.";
  return `Your School Head reminded you to finish: ${known.map((k) => TEACHER_TASK_LABELS[k]).join(", ")}.`;
}
