import { describe, expect, it } from "vitest";
import {
  classifyDiscrepancies,
  learnerDiscrepancies,
  type LearnerFact,
} from "@/lib/monitoring/discrepancy-rules";
import { aralTeacherSummary, buildMonitoringCounts } from "@/lib/monitoring/counts";
import { buildMonitoringAttention } from "@/lib/monitoring/attention";
import { autosaveStatus } from "@/lib/ui/use-autosave";
import { buildDraftRows, restorableRows } from "@/lib/ui/use-grid-draft";
import type { TaskStatus, TeacherTaskRow, TeacherTaskSummary } from "@/lib/teacher-tasks/types";

const active = { name: "Cruz, Ana", active: true };
const inactive = { name: "Reyes, Ben", active: false };

function learner(over: Partial<LearnerFact> = {}): LearnerFact {
  return {
    id: "l1",
    name: "Dela Cruz, Juan",
    gradeLevelId: "g4",
    gradeLabel: "Grade 4",
    sectionId: "s1",
    sectionName: "Sampaguita",
    sectionGradeLevelId: "g4",
    sectionAdviserId: "t1",
    teacherId: "t1",
    teacher: active,
    isAralLearner: false,
    aralTeacherId: null,
    aralTeacher: null,
    ...over,
  };
}

const enrolled = { learnerId: "l1", gradeLevelId: "g4", sectionId: "s1" };

describe("learnerDiscrepancies", () => {
  it("finds nothing on a consistent learner", () => {
    expect(learnerDiscrepancies(learner(), { hasActiveYear: true, enrollment: enrolled })).toEqual([]);
  });

  it("flags a learner with no adviser and no section", () => {
    const l = learner({ teacherId: null, teacher: null, sectionId: null, sectionName: null, sectionGradeLevelId: null, sectionAdviserId: null });
    expect(
      learnerDiscrepancies(l, { hasActiveYear: true, enrollment: { ...enrolled, sectionId: null } })
    ).toEqual(["NO_ADVISER", "NO_SECTION"]);
  });

  it("flags an inactive adviser, a different section adviser and a section of another grade", () => {
    const l = learner({ teacher: inactive, sectionAdviserId: "t2", sectionGradeLevelId: "g5" });
    expect(learnerDiscrepancies(l, { hasActiveYear: true, enrollment: enrolled })).toEqual([
      "INACTIVE_ADVISER",
      "ADVISER_MISMATCH",
      "SECTION_GRADE_MISMATCH",
    ]);
  });

  it("flags an ARAL learner whose ARAL teacher is missing or inactive", () => {
    const ctx = { hasActiveYear: true, enrollment: enrolled };
    expect(learnerDiscrepancies(learner({ isAralLearner: true }), ctx)).toEqual(["ARAL_NO_TUTOR"]);
    expect(
      learnerDiscrepancies(learner({ isAralLearner: true, aralTeacherId: "t9", aralTeacher: inactive }), ctx)
    ).toEqual(["ARAL_NO_TUTOR"]);
    expect(
      learnerDiscrepancies(learner({ isAralLearner: true, aralTeacherId: "t9", aralTeacher: active }), ctx)
    ).toEqual([]);
  });

  it("checks enrollment only when there is an active school year", () => {
    expect(learnerDiscrepancies(learner(), { hasActiveYear: true, enrollment: undefined })).toEqual(["NO_ENROLLMENT"]);
    expect(learnerDiscrepancies(learner(), { hasActiveYear: false, enrollment: undefined })).toEqual([]);
    expect(
      learnerDiscrepancies(learner(), { hasActiveYear: true, enrollment: { ...enrolled, sectionId: "s2" } })
    ).toEqual(["ENROLLMENT_MISMATCH"]);
  });
});

describe("classifyDiscrepancies", () => {
  it("groups learners and sections and totals them", () => {
    const summary = classifyDiscrepancies({
      hasActiveYear: true,
      learners: [learner(), learner({ id: "l2", teacherId: null, teacher: null })],
      sections: [
        { id: "s1", name: "Sampaguita", gradeLabel: "Grade 4", adviser: active },
        { id: "s2", name: "Rosal", gradeLabel: "Grade 4", adviser: null },
      ],
      enrollments: [enrolled, { learnerId: "l2", gradeLevelId: "g4", sectionId: "s1" }],
    });
    const count = (k: string) => summary.groups.find((g) => g.kind === k)!.count;
    expect(count("NO_ADVISER")).toBe(1);
    expect(count("SECTION_NO_ADVISER")).toBe(1);
    expect(summary.total).toBe(2);
    expect(summary.groups.find((g) => g.kind === "NO_ADVISER")!.items[0]).toMatchObject({
      id: "l2",
      placement: "Grade 4 · Sampaguita",
      teacher: null,
    });
  });
});

function status(kind: TaskStatus["kind"], state: TaskStatus["state"]): TaskStatus {
  return { kind, state, detail: "" };
}

function row(id: string, states: Partial<Record<TaskStatus["kind"], TaskStatus["state"]>>): TeacherTaskRow {
  const kinds = ["MOSY", "READING_LEVEL", "ATTENDANCE", "ARAL_PROFILING", "END_OF_TERM"] as const;
  const tasks = Object.fromEntries(kinds.map((k) => [k, status(k, states[k] ?? "NOT_APPLICABLE")])) as TeacherTaskRow["tasks"];
  return {
    teacherId: id,
    name: id,
    advisorySections: [],
    tasks,
    pendingKinds: kinds.filter((k) => tasks[k].state === "PENDING"),
    remindedToday: false,
  };
}

const tasks: TeacherTaskSummary = {
  todayKey: "2026-11-15",
  periods: { MOSY: "", READING_LEVEL: "", ATTENDANCE: "", ARAL_PROFILING: "", END_OF_TERM: "" },
  rows: [
    row("adviser-only", { END_OF_TERM: "PENDING", MOSY: "DONE" }),
    row("aral-behind", { ATTENDANCE: "PENDING", READING_LEVEL: "DONE", MOSY: "PENDING" }),
    row("aral-done", { ATTENDANCE: "DONE", READING_LEVEL: "DONE", ARAL_PROFILING: "DONE" }),
  ],
  teachersWithPending: 2,
  pendingByKind: { MOSY: 1, READING_LEVEL: 0, ATTENDANCE: 1, ARAL_PROFILING: 0, END_OF_TERM: 1 },
};

describe("aralTeacherSummary", () => {
  it("keeps ARAL teachers only, narrowed to ARAL tasks", () => {
    const s = aralTeacherSummary(tasks);
    expect(s.rows.map((r) => r.teacherId)).toEqual(["aral-behind", "aral-done"]);
    expect(s.rows[0]!.pendingKinds).toEqual(["ATTENDANCE"]);
    expect(s.teachersWithPending).toBe(1);
    expect(s.pendingByKind).toMatchObject({ ATTENDANCE: 1, MOSY: 0, END_OF_TERM: 0 });
  });
});

describe("buildMonitoringAttention", () => {
  const discrepancies = classifyDiscrepancies({
    hasActiveYear: false,
    learners: [learner({ id: "l2", teacherId: null, teacher: null, isAralLearner: true })],
    sections: [],
    enrollments: [],
  });
  const hrefs = { nonCompliance: "/nc", aral: "/aral", discrepancies: "/d" };

  it("lists teachers, ARAL teachers and learner issues with links to who", () => {
    const items = buildMonitoringAttention(buildMonitoringCounts(tasks, discrepancies), hrefs);
    expect(items.map((i) => [i.id, i.href, i.badge])).toEqual([
      ["monitoring:teachers", "/nc", "2 of 3"],
      ["monitoring:aral", "/aral", "1 of 2"],
      ["monitoring:unplaced", "/d#NO_ADVISER", "1 issue"],
      ["monitoring:aral-no-tutor", "/d#ARAL_NO_TUTOR", "1 learner"],
    ]);
  });

  it("is empty when nothing is behind", () => {
    const clean = { ...tasks, rows: [], teachersWithPending: 0 };
    const none = classifyDiscrepancies({ hasActiveYear: false, learners: [], sections: [], enrollments: [] });
    expect(buildMonitoringAttention(buildMonitoringCounts(clean, none), hrefs)).toEqual([]);
  });
});

describe("autosaveStatus", () => {
  it("reads the grid state and the last attempt", () => {
    expect(autosaveStatus(false, true, "error")).toBe("idle");
    expect(autosaveStatus(true, true, null)).toBe("waiting");
    expect(autosaveStatus(true, true, "offline")).toBe("offline");
    expect(autosaveStatus(true, true, "saved")).toBe("waiting");
    expect(autosaveStatus(true, false, "saved")).toBe("saved");
    expect(autosaveStatus(true, false, null)).toBe("idle");
    expect(autosaveStatus(true, true, "saving")).toBe("saving");
  });
});

describe("grid drafts", () => {
  const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  it("keeps only changed rows, with the value they started from", () => {
    expect(buildDraftRows({ a: 1, b: 2 }, { a: 1, b: 3 }, eq)).toEqual({ b: { base: "2", value: 3 } });
    expect(buildDraftRows({ a: 1 }, { a: 1 }, eq)).toBeNull();
  });

  it("restores a row only while its saved value is unchanged", () => {
    const draft = { b: { base: "2", value: 3 }, c: { base: "5", value: 6 }, gone: { base: "1", value: 9 } };
    // b still saved as 2: restored. c was saved as 7 elsewhere since: the server wins.
    expect(restorableRows({ b: 2, c: 7 }, draft)).toEqual({ b: 3 });
  });
});
