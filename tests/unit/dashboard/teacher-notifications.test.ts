import { describe, expect, it } from "vitest";
import { buildTeacherNotifications } from "@/lib/dashboard/teacher-notifications";

const hrefs = {
  aralHref: "/teacher/aral",
  attendanceHref: "/teacher/aral/g1/attendance",
  readingHref: "/teacher/aral/g1/reading-level",
};

describe("buildTeacherNotifications", () => {
  it("returns nothing when everything is done", () => {
    expect(
      buildTeacherNotifications({
        pendingAralProfiling: 0,
        attendanceMissingThisWeek: 0,
        readingPending: 0,
        ...hrefs,
      })
    ).toEqual([]);
  });

  it("builds one entry per outstanding item, in priority order", () => {
    const out = buildTeacherNotifications({
      pendingAralProfiling: 1,
      attendanceMissingThisWeek: 4,
      readingPending: 14,
      ...hrefs,
    });
    expect(out.map((n) => n.id)).toEqual([
      "aral-profiling",
      "attendance-week",
      "reading-month",
    ]);
    expect(out[0].title).toBe("1 ARAL profile incomplete");
    expect(out[1].description).toContain("4 sessions");
    expect(out[2].description).toContain("14 learners");
  });

  it("uses singular wording for a count of one", () => {
    const out = buildTeacherNotifications({
      pendingAralProfiling: 0,
      attendanceMissingThisWeek: 1,
      readingPending: 1,
      ...hrefs,
    });
    expect(out[0].description).toContain("1 session ");
    expect(out[1].description).toContain("1 learner ");
  });
});
