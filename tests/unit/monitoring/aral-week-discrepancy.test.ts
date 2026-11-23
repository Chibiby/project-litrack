import { describe, expect, it } from "vitest";
import { classifyDiscrepancies, openAralDays, type AralWeekFact } from "@/lib/monitoring/discrepancy-rules";
import { DISCREPANCY_KINDS, DISCREPANCY_META } from "@/lib/monitoring/discrepancy-kinds";

/**
 * Weekly Attendance needs at least 2 recorded days a week. A finished week in
 * which a tutor recorded only 1 day for a grade's ARAL learners is a
 * discrepancy, one row per tutor, grade and week. A week that holidays (or the
 * school year's start) leave with fewer than 2 open days is not flagged.
 * Friday is locked in the grid, so open days are Monday to Thursday.
 */

const week = (over: Partial<AralWeekFact> = {}): AralWeekFact => ({
  tutorId: "t1",
  tutorName: "Cruz, Ana",
  gradeLevelId: "g3",
  gradeLabel: "Grade 3",
  weekStartKey: "2026-11-09",
  recordedDays: 1,
  openDays: 4,
  ...over,
});

const facts = (aralWeeks: AralWeekFact[]) => ({
  hasActiveYear: true,
  learners: [],
  sections: [],
  enrollments: [],
  aralWeeks,
});

const group = (summary: ReturnType<typeof classifyDiscrepancies>) =>
  summary.groups.find((g) => g.kind === "ARAL_WEEK_ONE_DAY")!;

describe("ARAL_WEEK_ONE_DAY", () => {
  it("is a listed discrepancy with a tutor-week row", () => {
    expect(DISCREPANCY_KINDS).toContain("ARAL_WEEK_ONE_DAY");
    expect(DISCREPANCY_META.ARAL_WEEK_ONE_DAY.subject).toBe("tutor-week");
  });

  it("flags a tutor-grade-week with exactly 1 recorded day", () => {
    const g = group(classifyDiscrepancies(facts([week()])));
    expect(g.count).toBe(1);
    expect(g.items[0]).toEqual({
      id: "t1|g3|2026-11-09",
      name: "Week of Nov 9, 2026",
      placement: "Grade 3",
      teacher: "Cruz, Ana",
    });
  });

  it("does not flag 2 or more recorded days", () => {
    expect(group(classifyDiscrepancies(facts([week({ recordedDays: 2 }), week({ recordedDays: 4 })]))).count).toBe(0);
  });

  it("does not flag a week that leaves fewer than 2 open days", () => {
    expect(group(classifyDiscrepancies(facts([week({ openDays: 1 })]))).count).toBe(0);
  });

  it("counts the summary total and keeps the newest week first", () => {
    const s = classifyDiscrepancies(
      facts([week({ weekStartKey: "2026-11-02" }), week({ weekStartKey: "2026-11-16", tutorId: "t2" })])
    );
    expect(s.total).toBe(2);
    expect(group(s).items.map((i) => i.id)).toEqual(["t2|g3|2026-11-16", "t1|g3|2026-11-02"]);
  });

  it("treats facts without aralWeeks as none", () => {
    const s = classifyDiscrepancies({ hasActiveYear: true, learners: [], sections: [], enrollments: [] });
    expect(group(s).count).toBe(0);
  });
});

describe("openAralDays", () => {
  it("is Monday to Thursday: Friday is locked in the grid", () => {
    expect(openAralDays("2026-11-09", { yearStartKey: "2026-06-01", holidayKeys: new Set() })).toBe(4);
  });

  it("drops holidays", () => {
    const holidayKeys = new Set(["2026-11-10", "2026-11-11", "2026-11-13"]);
    expect(openAralDays("2026-11-09", { yearStartKey: "2026-06-01", holidayKeys })).toBe(2);
  });

  it("drops days before the school year starts", () => {
    expect(openAralDays("2026-06-01", { yearStartKey: "2026-06-04", holidayKeys: new Set() })).toBe(1);
  });
});
