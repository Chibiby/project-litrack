/**
 * School Head "Teacher Tasks" monitor — the contract.
 *
 * Plain types and constants only: no Prisma runtime, no `server-only`, so the
 * page, the client components, the validators and the unit tests can all import
 * it. The server builds these shapes in `queries.ts`; the pure rules that decide
 * each status live in `rules.ts`.
 *
 * Everything here is JSON-safe (strings, numbers, booleans, arrays, records) —
 * the summary passes through `unstable_cache` and across the RSC boundary.
 */

/** The five tasks, in display order. */
export const TEACHER_TASK_KINDS = [
  "MOSY",
  "READING_LEVEL",
  "ATTENDANCE",
  "ARAL_PROFILING",
  "END_OF_TERM",
] as const;

export type TeacherTaskKind = (typeof TEACHER_TASK_KINDS)[number];

/** Column headings and the words the reminder sentence uses. */
export const TEACHER_TASK_LABELS: Record<TeacherTaskKind, string> = {
  MOSY: "MOSY",
  READING_LEVEL: "Reading level",
  ATTENDANCE: "Attendance",
  ARAL_PROFILING: "ARAL profiling",
  END_OF_TERM: "End-of-term",
};

/** True when `value` names one of the five task kinds. */
export function isTeacherTaskKind(value: unknown): value is TeacherTaskKind {
  return typeof value === "string" && (TEACHER_TASK_KINDS as readonly string[]).includes(value);
}

export type TaskState = "DONE" | "PENDING" | "NOT_APPLICABLE";

/** Short state words for badges and the export's status cells. */
export const TASK_STATE_LABELS: Record<TaskState, string> = {
  DONE: "Done",
  PENDING: "Not done",
  NOT_APPLICABLE: "N/A",
};

export type TaskStatus = {
  kind: TeacherTaskKind;
  state: TaskState;
  /** Learners still missing the task. Set for learner-counted tasks (not ATTENDANCE). */
  missing?: number;
  /** Learners the task covers. Set alongside `missing`. */
  total?: number;
  /**
   * One sentence in the user's language: what was checked and what is missing,
   * or why the task does not apply to this teacher.
   */
  detail: string;
};

export type TeacherTaskRow = {
  teacherId: string;
  /** Surname-first, as the Teachers page lists the teacher ("Cruz, Juan D."). */
  name: string;
  /** Live advisory sections, "Grade 4 · Sampaguita". Empty when the teacher advises none. */
  advisorySections: { id: string; label: string }[];
  tasks: Record<TeacherTaskKind, TaskStatus>;
  /** Kinds in `PENDING`, in `TEACHER_TASK_KINDS` order. */
  pendingKinds: TeacherTaskKind[];
  /** A task reminder already went to this teacher today (school-local day). */
  remindedToday: boolean;
};

export type TeacherTaskSummary = {
  /** School-local `YYYY-MM-DD` the summary was computed for. */
  todayKey: string;
  /** Label of the period each task was checked against ("September 2026"). */
  periods: Record<TeacherTaskKind, string>;
  /** Active, approved teachers of the school, surname order. */
  rows: TeacherTaskRow[];
  /** Teachers with at least one `PENDING` task. */
  teachersWithPending: number;
  /** Teachers `PENDING` on each task. */
  pendingByKind: Record<TeacherTaskKind, number>;
};
