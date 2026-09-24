import { describe, expect, it } from "vitest";
import {
  classifyCompliance,
  recentAttendanceFloorKey,
  type SchoolComplianceFacts,
} from "@/lib/summary/shape/compliance";

/**
 * T16: one case per non-compliance definition in spec 4.6 (Q8 default), so a
 * definition cannot drift without a test edit.
 */

const TODAY = "2026-09-24";

/** A school with nothing wrong: every flag's opposite. */
function healthy(overrides: Partial<SchoolComplianceFacts> = {}): SchoolComplianceFacts {
  return {
    liveLearners: 40,
    pendingTeachers: 0,
    gradesWithoutAdviser: 0,
    aralLearners: 10,
    lastAttendanceKey: "2026-09-23",
    readingLearnersThisMonth: 10,
    incompleteLearners: 0,
    nonArchivedLearners: 40,
    activeEnrollments: 40,
    pointerDrift: 0,
    lastWeekMarkedLearners: 10,
    ...overrides,
  };
}

describe("classifyCompliance", () => {
  it("raises nothing for a healthy school", () => {
    expect(classifyCompliance(healthy(), TODAY)).toEqual({ flags: [], reasons: [] });
  });

  it("No encoded data: zero live learners", () => {
    const r = classifyCompliance(
      healthy({ liveLearners: 0, nonArchivedLearners: 0, activeEnrollments: 0, aralLearners: 0, readingLearnersThisMonth: 0, lastWeekMarkedLearners: 0 }),
      TODAY
    );
    expect(r.flags).toEqual(["NO_ENCODED_DATA"]);
    expect(r.reasons).toEqual(["no_learners"]);
  });

  it("Pending: a teacher waiting for approval", () => {
    const r = classifyCompliance(healthy({ pendingTeachers: 1 }), TODAY);
    expect(r.flags).toEqual(["PENDING"]);
    expect(r.reasons).toEqual(["pending_teachers"]);
  });

  it("Pending: a grade with no active adviser", () => {
    const r = classifyCompliance(healthy({ gradesWithoutAdviser: 2 }), TODAY);
    expect(r.flags).toEqual(["PENDING"]);
    expect(r.reasons).toEqual(["grades_without_adviser"]);
  });

  it("Not updated: no attendance in the last 14 days", () => {
    const floor = recentAttendanceFloorKey(TODAY);
    expect(floor).toBe("2026-09-11");
    expect(classifyCompliance(healthy({ lastAttendanceKey: floor }), TODAY).flags).toEqual([]);
    const r = classifyCompliance(healthy({ lastAttendanceKey: "2026-09-10" }), TODAY);
    expect(r.flags).toEqual(["NOT_UPDATED"]);
    expect(r.reasons).toEqual(["no_recent_attendance"]);
    expect(classifyCompliance(healthy({ lastAttendanceKey: null }), TODAY).flags).toEqual([
      "NOT_UPDATED",
    ]);
  });

  it("Not updated: no reading level this month", () => {
    const r = classifyCompliance(healthy({ readingLearnersThisMonth: 0 }), TODAY);
    expect(r.flags).toEqual(["NOT_UPDATED"]);
    expect(r.reasons).toEqual(["no_reading_this_month"]);
  });

  it("Not updated never applies to a school with no ARAL learners", () => {
    const r = classifyCompliance(
      healthy({ aralLearners: 0, lastAttendanceKey: null, readingLearnersThisMonth: 0, lastWeekMarkedLearners: 0 }),
      TODAY
    );
    expect(r.flags).toEqual([]);
  });

  it("Incomplete: an enrolled learner missing a required answer", () => {
    const r = classifyCompliance(healthy({ incompleteLearners: 3 }), TODAY);
    expect(r.flags).toEqual(["INCOMPLETE"]);
  });

  it("Discrepancies: learner count differs from active enrollments", () => {
    const r = classifyCompliance(healthy({ activeEnrollments: 39 }), TODAY);
    expect(r.flags).toEqual(["DISCREPANCIES"]);
    expect(r.reasons).toEqual(["enrollment_count_mismatch"]);
  });

  it("Discrepancies: a learner's grade differs from their active enrollment", () => {
    const r = classifyCompliance(healthy({ pointerDrift: 1 }), TODAY);
    expect(r.reasons).toEqual(["grade_pointer_drift"]);
  });

  it("Discrepancies: last week's attendance does not cover the ARAL roster", () => {
    const r = classifyCompliance(healthy({ lastWeekMarkedLearners: 8 }), TODAY);
    expect(r.reasons).toEqual(["attendance_roster_mismatch"]);
    // Nothing recorded last week is "Not updated" territory, not a discrepancy.
    expect(classifyCompliance(healthy({ lastWeekMarkedLearners: 0 }), TODAY).flags).toEqual([]);
  });

  it("Discrepancies: this month's reading records do not cover the ARAL roster", () => {
    const r = classifyCompliance(healthy({ readingLearnersThisMonth: 7 }), TODAY);
    expect(r.flags).toEqual(["DISCREPANCIES"]);
    expect(r.reasons).toEqual(["reading_roster_mismatch"]);
  });

  it("reports several flags in a fixed order", () => {
    const r = classifyCompliance(
      healthy({ pointerDrift: 1, incompleteLearners: 1, pendingTeachers: 1 }),
      TODAY
    );
    expect(r.flags).toEqual(["PENDING", "INCOMPLETE", "DISCREPANCIES"]);
  });
});
