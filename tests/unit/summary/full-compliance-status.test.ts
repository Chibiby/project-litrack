import { describe, expect, it } from "vitest";
import type { SchoolComplianceFacts } from "@/lib/summary/shape/compliance";
import {
  baseStatusOf,
  daysBetweenKeys,
  displayStatus,
  isAtRisk,
  streakDays,
} from "@/lib/summary/shape/full-compliance";

const TODAY = "2026-11-24";

/** A school with zero flags on TODAY. */
function clean(over: Partial<SchoolComplianceFacts> = {}): SchoolComplianceFacts {
  return {
    liveLearners: 20,
    pendingTeachers: 0,
    gradesWithoutAdviser: 0,
    aralLearners: 5,
    lastAttendanceKey: "2026-11-21",
    readingLearnersThisMonth: 5,
    incompleteLearners: 0,
    nonArchivedLearners: 20,
    activeEnrollments: 20,
    pointerDrift: 0,
    lastWeekMarkedLearners: 5,
    mosy: null,
    ...over,
  };
}

function status(facts: SchoolComplianceFacts, compliantSince: string | null, trackingStart = "2026-10-01", today = TODAY, hasActiveYear = true) {
  const { base } = baseStatusOf(facts, hasActiveYear, today);
  return displayStatus({ base, compliantSince, trackingStart, facts, todayKey: today });
}

describe("baseStatusOf", () => {
  it("no learners → NOT_EVALUATED", () => {
    expect(baseStatusOf(clean({ liveLearners: 0, nonArchivedLearners: 0, activeEnrollments: 0 }), true, TODAY).base).toBe(
      "NOT_EVALUATED"
    );
  });

  it("learners but no active year → NOT_EVALUATED even though classify flags it", () => {
    const facts = clean({ activeEnrollments: 0 });
    const r = baseStatusOf(facts, false, TODAY);
    expect(r.base).toBe("NOT_EVALUATED");
    expect(r.flags).toContain("DISCREPANCIES");
  });

  it("any flag → NON_COMPLIANT, zero flags → COMPLIANT", () => {
    expect(baseStatusOf(clean({ pendingTeachers: 1 }), true, TODAY)).toEqual({ base: "NON_COMPLIANT", flags: ["PENDING"] });
    expect(baseStatusOf(clean(), true, TODAY)).toEqual({ base: "COMPLIANT", flags: [] });
  });
});

describe("isAtRisk", () => {
  it("last attendance 11 days ago is at risk; 9 days is not", () => {
    expect(isAtRisk(clean({ lastAttendanceKey: "2026-11-13" }), TODAY)).toBe(true);
    expect(isAtRisk(clean({ lastAttendanceKey: "2026-11-15" }), TODAY)).toBe(false);
  });

  it("a school with no ARAL learners has no attendance deadline", () => {
    expect(
      isAtRisk(clean({ aralLearners: 0, lastAttendanceKey: "2026-11-01" }), TODAY)
    ).toBe(false);
  });
});

describe("displayStatus", () => {
  it("any flag → NON_COMPLIANT", () => {
    expect(status(clean({ incompleteLearners: 2 }), null)).toBe("NON_COMPLIANT");
  });

  it("zero flags with a near deadline → AT_RISK, ahead of the streak statuses", () => {
    expect(status(clean({ lastAttendanceKey: "2026-11-12" }), "2026-09-01")).toBe("AT_RISK");
  });

  it("compliant 3 days, after tracking started → NEW", () => {
    expect(status(clean(), "2026-11-22")).toBe("NEW");
  });

  it("compliant since the day tracking started → FULL, not NEW", () => {
    expect(status(clean(), "2026-11-22", "2026-11-22")).toBe("FULL");
  });

  it("30 days → CONSISTENT, 29 days → FULL", () => {
    expect(status(clean(), "2026-10-26")).toBe("CONSISTENT");
    expect(status(clean(), "2026-10-27")).toBe("FULL");
  });

  it("not evaluated wins over everything", () => {
    expect(status(clean(), "2026-01-01", "2026-01-01", TODAY, false)).toBe("NOT_EVALUATED");
  });
});

describe("streaks", () => {
  it("counts both ends", () => {
    expect(streakDays("2026-11-20", "2026-11-24")).toBe(5);
    expect(streakDays(TODAY, TODAY)).toBe(1);
    expect(streakDays(null, TODAY)).toBeNull();
  });

  it("crosses month and year ends by calendar day", () => {
    expect(daysBetweenKeys("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetweenKeys("2026-02-28", "2026-03-01")).toBe(1);
  });
});
