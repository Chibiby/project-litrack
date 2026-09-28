import { describe, expect, it } from "vitest";
import {
  classifyCompliance,
  complianceFlagSlug,
  filterComplianceResult,
  filterComplianceResultForExport,
  isComplianceFlagFilter,
  parseComplianceFlagParam,
  recentAttendanceFloorKey,
  type SchoolComplianceFacts,
} from "@/lib/summary/shape/compliance";
import type { FacetResult } from "@/lib/summary/types";

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

/** T: the Flag filter (`?flag=`) on the compliance summary page and export. */
describe("isComplianceFlagFilter / parseComplianceFlagParam", () => {
  it("accepts every flag id and the no-district-admin list", () => {
    for (const id of ["NO_ENCODED_DATA", "PENDING", "NOT_UPDATED", "INCOMPLETE", "DISCREPANCIES", "noDistrictAdmin"]) {
      expect(isComplianceFlagFilter(id)).toBe(true);
    }
  });

  it("rejects anything else, including case variants and empty string", () => {
    for (const id of ["COMPLIANT", "no_encoded_data", "", undefined, null, 1]) {
      expect(isComplianceFlagFilter(id)).toBe(false);
    }
  });

  it("parses a known ?flag= value", () => {
    expect(parseComplianceFlagParam("NO_ENCODED_DATA")).toBe("NO_ENCODED_DATA");
  });

  it("treats an unknown, absent or repeated ?flag= as All flags (null)", () => {
    expect(parseComplianceFlagParam("BOGUS")).toBeNull();
    expect(parseComplianceFlagParam(undefined)).toBeNull();
    expect(parseComplianceFlagParam(["NO_ENCODED_DATA", "PENDING"])).toBe("NO_ENCODED_DATA");
  });
});

describe("complianceFlagSlug", () => {
  it("kebab-cases every filter id for the export filename", () => {
    expect(complianceFlagSlug("NO_ENCODED_DATA")).toBe("no-encoded-data");
    expect(complianceFlagSlug("PENDING")).toBe("pending");
    expect(complianceFlagSlug("noDistrictAdmin")).toBe("no-district-admin");
  });
});

describe("filterComplianceResult / filterComplianceResultForExport", () => {
  const result: FacetResult = {
    facetId: "compliance",
    title: "Non-compliance",
    subtitle: "Active schools",
    level: "overall",
    params: { level: "overall" },
    schoolCount: 2,
    notes: [],
    gaps: [],
    sections: [
      {
        id: "flags",
        title: "Schools flagged",
        kind: "multi",
        byGrade: false,
        buckets: [],
        baseLabel: "% of active schools",
        table: { groups: [] },
      },
    ],
    lists: [
      { id: "NO_ENCODED_DATA", title: "No encoded data", columns: ["School"], rows: [["A"]] },
      { id: "PENDING", title: "Pending", columns: ["School"], rows: [] },
      { id: "noDistrictAdmin", title: "Schools with no district admin", columns: ["School"], rows: [] },
    ],
    computedAt: "2026-09-28T00:00:00.000Z",
  };

  it("is a no-op with no flag chosen", () => {
    expect(filterComplianceResult(result, null)).toBe(result);
    expect(filterComplianceResultForExport(result, null)).toBe(result);
  });

  it("narrows the page view to the chosen list, keeping the overview section", () => {
    const filtered = filterComplianceResult(result, "NO_ENCODED_DATA");
    expect(filtered.lists).toEqual([result.lists[0]]);
    expect(filtered.sections).toBe(result.sections);
  });

  it("narrows the export to only that list's rows, dropping the overview section", () => {
    const filtered = filterComplianceResultForExport(result, "NO_ENCODED_DATA");
    expect(filtered.lists).toEqual([result.lists[0]]);
    expect(filtered.sections).toEqual([]);
  });

  it("describes only the chosen list in the export summary", () => {
    const filtered = filterComplianceResultForExport(
      { ...result, schoolCount: 333, notes: ["A school can carry more than one flag"] },
      "NO_ENCODED_DATA"
    );
    expect(filtered.schoolCount).toBe(1);
    expect(filtered.notes.join(" ")).toContain("No encoded data: The school has no learners encoded.");
    expect(filtered.notes.join(" ")).not.toContain("more than one flag");
  });

  it("returns an empty list rather than throwing when the flag matches nothing", () => {
    const filtered = filterComplianceResult(result, "DISCREPANCIES");
    expect(filtered.lists).toEqual([]);
  });
});
