import { describe, expect, it } from "vitest";
import {
  buildTeacherTasksExportTable,
  describeTeacherTasksFilters,
  TEACHER_TASKS_EXPORT_TITLE,
} from "@/lib/teacher-tasks/export";
import {
  TEACHER_TASK_KINDS,
  type TaskStatus,
  type TeacherTaskKind,
  type TeacherTaskRow,
  type TeacherTaskSummary,
} from "@/lib/teacher-tasks/types";
import type { ReportFrame } from "@/lib/reports/report-frame";

const PERIODS: Record<TeacherTaskKind, string> = {
  MOSY: "Second Term (Nov 2 - Nov 27, 2026)",
  READING_LEVEL: "January 2027",
  ATTENDANCE: "Jan 25 - Jan 29, 2027",
  ARAL_PROFILING: "No deadline",
  END_OF_TERM: "First Term (Aug 3 - Oct 30, 2026)",
};

function task(kind: TeacherTaskKind, state: TaskStatus["state"], detail: string): TaskStatus {
  return { kind, state, detail };
}

function row(over: Partial<TeacherTaskRow> & { teacherId: string; name: string }): TeacherTaskRow {
  const tasks = Object.fromEntries(
    TEACHER_TASK_KINDS.map((k) => [k, task(k, "DONE", `${k} ok`)])
  ) as Record<TeacherTaskKind, TaskStatus>;
  return { advisorySections: [], tasks, pendingKinds: [], remindedToday: false, ...over };
}

const cruz = row({
  teacherId: "t1",
  name: "Cruz, Juan D.",
  advisorySections: [
    { id: "s1", label: "Grade 4 · Sampaguita" },
    { id: "s2", label: "Grade 5 · Rosal" },
  ],
  pendingKinds: ["ATTENDANCE"],
  tasks: {
    ...row({ teacherId: "x", name: "x" }).tasks,
    ATTENDANCE: task("ATTENDANCE", "PENDING", "No attendance recorded for Jan 25 - Jan 29, 2027"),
    MOSY: task("MOSY", "NOT_APPLICABLE", "Floating teacher"),
  },
});
const reyes = row({ teacherId: "t2", name: "Reyes, Ana" });

const summary: TeacherTaskSummary = {
  todayKey: "2027-02-10",
  periods: PERIODS,
  rows: [cruz, reyes],
  teachersWithPending: 1,
  pendingByKind: { MOSY: 0, READING_LEVEL: 0, ATTENDANCE: 1, ARAL_PROFILING: 0, END_OF_TERM: 0 },
};

const frame = { school: "Test School" } as unknown as ReportFrame;
const asOf = new Date(2027, 1, 10);

describe("describeTeacherTasksFilters", () => {
  it("covers every combination of kind and onlyPending", () => {
    expect(describeTeacherTasksFilters({ kind: null, onlyPending: false })).toBe(
      "Showing: all active teachers  |  Task: All tasks"
    );
    expect(describeTeacherTasksFilters({ kind: null, onlyPending: true })).toBe(
      "Showing: teachers with a pending task  |  Task: All tasks"
    );
    expect(describeTeacherTasksFilters({ kind: "ATTENDANCE", onlyPending: true })).toBe(
      "Showing: teachers who have not done Attendance  |  Task: Attendance"
    );
    expect(describeTeacherTasksFilters({ kind: "READING_LEVEL", onlyPending: false })).toBe(
      "Showing: all active teachers  |  Task: Reading level"
    );
  });
});

describe("buildTeacherTasksExportTable - all tasks", () => {
  const table = buildTeacherTasksExportTable({
    frame,
    summary,
    rows: [cruz, reyes],
    kind: null,
    onlyPending: false,
    asOf,
  });

  it("titles the file and stamps the as-of day", () => {
    expect(table.title).toBe(TEACHER_TASKS_EXPORT_TITLE);
    expect(table.reportingPeriod).toBe("As of 10 February 2027");
    expect(table.frame).toBe(frame);
  });

  it("headers: #, Teacher, Advisory sections, then status + details per task with the period", () => {
    expect(table.columns.map((c) => c.header)).toEqual([
      "#",
      "Teacher",
      "Advisory sections",
      "MOSY (Second Term (Nov 2 - Nov 27, 2026))",
      "MOSY details",
      "Reading level (January 2027)",
      "Reading level details",
      "Attendance (Jan 25 - Jan 29, 2027)",
      "Attendance details",
      "ARAL profiling (No deadline)",
      "ARAL profiling details",
      "End-of-term (First Term (Aug 3 - Oct 30, 2026))",
      "End-of-term details",
    ]);
  });

  it("a row per listed teacher, numbered, with state words and detail sentences", () => {
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.slice(0, 3)).toEqual([
      1,
      "Cruz, Juan D.",
      "Grade 4 · Sampaguita, Grade 5 · Rosal",
    ]);
    // MOSY, Reading, Attendance cells of the first teacher.
    expect(table.rows[0]!.slice(3, 9)).toEqual([
      "N/A",
      "Floating teacher",
      "Done",
      "READING_LEVEL ok",
      "Not done",
      "No attendance recorded for Jan 25 - Jan 29, 2027",
    ]);
    expect(table.rows[1]!.slice(0, 3)).toEqual([2, "Reyes, Ana", null]);
    expect(table.rows.every((r) => r.length === table.columns.length)).toBe(true);
  });

  it("summary lines carry the filters, each period, and the counts", () => {
    expect(table.summary).toEqual([
      "Filters applied: Showing: all active teachers  |  Task: All tasks",
      "MOSY checked for: Second Term (Nov 2 - Nov 27, 2026)",
      "Reading level checked for: January 2027",
      "Attendance checked for: Jan 25 - Jan 29, 2027",
      "ARAL profiling checked for: No deadline",
      "End-of-term checked for: First Term (Aug 3 - Oct 30, 2026)",
      "1 of 2 teacher(s) have at least one pending task",
      "2 teacher(s) listed",
    ]);
  });

  it("lays the same columns and rows into the single block", () => {
    expect(table.blocks).toHaveLength(1);
    expect(table.blocks![0]!.columns).toBe(table.columns);
    expect(table.blocks![0]!.rows).toBe(table.rows);
  });
});

describe("buildTeacherTasksExportTable - one task, pending only", () => {
  const table = buildTeacherTasksExportTable({
    frame,
    summary,
    rows: [cruz],
    kind: "ATTENDANCE",
    onlyPending: true,
    asOf,
  });

  it("only that task's two columns follow the fixed three", () => {
    expect(table.columns.map((c) => c.header)).toEqual([
      "#",
      "Teacher",
      "Advisory sections",
      "Attendance (Jan 25 - Jan 29, 2027)",
      "Attendance details",
    ]);
    expect(table.rows).toEqual([
      [
        1,
        "Cruz, Juan D.",
        "Grade 4 · Sampaguita, Grade 5 · Rosal",
        "Not done",
        "No attendance recorded for Jan 25 - Jan 29, 2027",
      ],
    ]);
  });

  it("the filter and period lines name only that task; counts use the whole school", () => {
    expect(table.summary).toEqual([
      "Filters applied: Showing: teachers who have not done Attendance  |  Task: Attendance",
      "Attendance checked for: Jan 25 - Jan 29, 2027",
      "1 of 2 teacher(s) have at least one pending task",
      "1 teacher(s) listed",
    ]);
  });

  it("names no learner anywhere in the file", () => {
    expect(JSON.stringify(table)).not.toMatch(/learner/i);
  });
});
