/**
 * Teacher Tasks -> Excel: the pure layout layer.
 *
 * Turns a `TeacherTaskSummary` into a `ReportTable`, which `renderExcel`
 * (`src/lib/reports/render.ts`) draws in the same DepEd template as every other
 * export. No Prisma runtime and no `server-only`, so it is testable with
 * hand-built fixtures; the action loads the data and the frame. Same split as
 * `src/lib/aral/mosy-export.ts`.
 *
 * Staff data only — teacher names, advisory section labels and counts. No
 * learner is named anywhere in the file.
 */
import { formatReportDate, type ReportFrame } from "@/lib/reports/report-frame";
import type { ReportBlock, ReportTable } from "@/lib/reports/render";
import {
  TASK_STATE_LABELS,
  TEACHER_TASK_KINDS,
  TEACHER_TASK_LABELS,
  type TeacherTaskKind,
  type TeacherTaskRow,
  type TeacherTaskSummary,
} from "@/lib/teacher-tasks/types";

export const TEACHER_TASKS_EXPORT_TITLE = "Teacher Tasks — Pending Submissions";

export type TeacherTasksExportInput = {
  frame: ReportFrame;
  summary: TeacherTaskSummary;
  /** Rows to list, already filtered (`filterTeacherTaskRows`). */
  rows: TeacherTaskRow[];
  /** One task's columns only; null = all five. */
  kind: TeacherTaskKind | null;
  onlyPending: boolean;
  /** School-local day the file is stamped with (`schoolToday()`). */
  asOf: Date;
};

function kindsOf(kind: TeacherTaskKind | null): readonly TeacherTaskKind[] {
  return kind ? [kind] : TEACHER_TASK_KINDS;
}

/** "Showing: teachers with a pending task  |  Task: Attendance". */
export function describeTeacherTasksFilters(filter: {
  kind: TeacherTaskKind | null;
  onlyPending: boolean;
}): string {
  const who = filter.onlyPending
    ? filter.kind
      ? `teachers who have not done ${TEACHER_TASK_LABELS[filter.kind]}`
      : "teachers with a pending task"
    : "all active teachers";
  const task = filter.kind ? TEACHER_TASK_LABELS[filter.kind] : "All tasks";
  return `Showing: ${who}  |  Task: ${task}`;
}

export function buildTeacherTasksExportBlock(input: TeacherTasksExportInput): ReportBlock {
  const kinds = kindsOf(input.kind);
  return {
    heading: "Teacher tasks",
    sheetName: "Teacher Tasks",
    // The header row carries each task's period, so the file reads on its own.
    columns: [
      { header: "#", width: 4 },
      { header: "Teacher", width: 26 },
      { header: "Advisory sections", width: 26 },
      ...kinds.flatMap((k) => [
        { header: `${TEACHER_TASK_LABELS[k]} (${input.summary.periods[k]})`, width: 16 },
        { header: `${TEACHER_TASK_LABELS[k]} details`, width: 36 },
      ]),
    ],
    wrap: true,
    rows: input.rows.map((row, i) => [
      i + 1,
      row.name,
      row.advisorySections.length > 0 ? row.advisorySections.map((s) => s.label).join(", ") : null,
      ...kinds.flatMap((k) => [TASK_STATE_LABELS[row.tasks[k].state], row.tasks[k].detail]),
    ]),
    freezeColumns: 2,
  };
}

/** The whole file, ready for `renderExcel(table, { purpose, generatedOn })`. */
export function buildTeacherTasksExportTable(input: TeacherTasksExportInput): ReportTable {
  const block = buildTeacherTasksExportBlock(input);
  const kinds = kindsOf(input.kind);
  return {
    title: TEACHER_TASKS_EXPORT_TITLE,
    reportingPeriod: `As of ${formatReportDate(input.asOf)}`,
    gradeSection: { label: "All Teachers" },
    summary: [
      `Filters applied: ${describeTeacherTasksFilters(input)}`,
      ...kinds.map((k) => `${TEACHER_TASK_LABELS[k]} checked for: ${input.summary.periods[k]}`),
      `${input.summary.teachersWithPending} of ${input.summary.rows.length} teacher(s) have at least one pending task`,
      `${input.rows.length} teacher(s) listed`,
    ],
    frame: input.frame,
    columns: block.columns,
    rows: block.rows,
    blocks: [block],
  };
}
