import { describe, expect, it } from "vitest";
import { aralQuickActions } from "@/components/dashboard/teacher/tasks-panel";

describe("aralQuickActions", () => {
  it("offers a volunteer ARAL work only — no Add Learner, no Reports", () => {
    const actions = aralQuickActions({
      attendance: "/teacher/aral/g1/attendance",
      reading: "/teacher/aral/g1/reading-level",
      profiling: "/teacher/aral/profiling?status=pending",
      roster: "/teacher/aral?grade=g1",
    });
    expect(actions.map((a) => [a.label, a.href])).toEqual([
      ["Take Attendance", "/teacher/aral/g1/attendance"],
      ["Record Reading Level", "/teacher/aral/g1/reading-level"],
      ["ARAL Profiling", "/teacher/aral/profiling?status=pending"],
      ["My ARAL Learners", "/teacher/aral?grade=g1"],
    ]);
    expect(
      actions.some((a) => a.href.startsWith("/teacher/learners") || a.href.startsWith("/teacher/reports"))
    ).toBe(false);
  });
});
