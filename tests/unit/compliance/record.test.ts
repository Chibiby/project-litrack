import { describe, expect, it } from "vitest";
import { planComplianceChanges, type StoredComplianceState } from "@/lib/compliance/plan";
import type { RawComplianceRow } from "@/lib/summary/queries/compliance";

const TODAY = "2026-11-24";

/** A raw row with zero flags on TODAY. */
function row(schoolId: string, over: Partial<RawComplianceRow> = {}): RawComplianceRow {
  return {
    school_id: schoolId,
    live: 10,
    non_archived: 10,
    pending: 0,
    grades_no_adviser: 0,
    aral: 0,
    incomplete: 0,
    enrollments: 10,
    drift: 0,
    last_attendance: null,
    reading: 0,
    last_week: 0,
    has_admin: true,
    mosy_not_updated: 0,
    mosy_for_decision: 0,
    sy_start: "2026-06-15T00:00:00.000Z",
    mosy_override_start: null,
    mosy_override_end: null,
    mosy_override_deadline: null,
    ...over,
  };
}

function state(schoolId: string, over: Partial<StoredComplianceState> = {}): StoredComplianceState {
  return {
    schoolId,
    status: "COMPLIANT",
    compliantSince: "2026-10-01",
    lastCheckedOn: "2026-11-23",
    flags: [],
    ...over,
  };
}

describe("planComplianceChanges", () => {
  it("first run creates states and no events", () => {
    const plan = planComplianceChanges({
      rows: [row("a"), row("b", { pending: 2 }), row("c", { live: 0, non_archived: 0, enrollments: 0 })],
      activeSchoolIds: new Set(["a", "b", "c"]),
      states: [],
      todayKey: TODAY,
    });
    expect(plan.skipped).toBe(false);
    expect(plan.events).toEqual([]);
    expect(plan.upserts).toEqual([
      { schoolId: "a", status: "COMPLIANT", compliantSince: TODAY, lastCheckedOn: TODAY, flags: [] },
      { schoolId: "b", status: "NON_COMPLIANT", compliantSince: null, lastCheckedOn: TODAY, flags: ["PENDING"] },
      {
        schoolId: "c",
        status: "NOT_EVALUATED",
        compliantSince: null,
        lastCheckedOn: TODAY,
        flags: ["NO_ENCODED_DATA"],
      },
    ]);
  });

  it("skips when every active school was already checked today", () => {
    const plan = planComplianceChanges({
      rows: [row("a")],
      activeSchoolIds: new Set(["a"]),
      states: [state("a", { lastCheckedOn: TODAY })],
      todayKey: TODAY,
    });
    expect(plan).toEqual({ skipped: true, upserts: [], events: [] });
  });

  it("an unchanged school keeps its streak and gets no event", () => {
    const plan = planComplianceChanges({
      rows: [row("a")],
      activeSchoolIds: new Set(["a"]),
      states: [state("a")],
      todayKey: TODAY,
    });
    expect(plan.events).toEqual([]);
    expect(plan.upserts).toEqual([
      { schoolId: "a", status: "COMPLIANT", compliantSince: "2026-10-01", lastCheckedOn: TODAY, flags: [] },
    ]);
  });

  it("COMPLIANT → NON_COMPLIANT writes one event and clears compliantSince", () => {
    const plan = planComplianceChanges({
      rows: [row("a", { incomplete: 3 })],
      activeSchoolIds: new Set(["a"]),
      states: [state("a")],
      todayKey: TODAY,
    });
    expect(plan.upserts[0]).toMatchObject({ status: "NON_COMPLIANT", compliantSince: null, flags: ["INCOMPLETE"] });
    expect(plan.events).toEqual([
      { schoolId: "a", dateKey: TODAY, fromStatus: "COMPLIANT", toStatus: "NON_COMPLIANT", flags: ["INCOMPLETE"] },
    ]);
  });

  it("NON_COMPLIANT → COMPLIANT starts the streak today", () => {
    const plan = planComplianceChanges({
      rows: [row("a")],
      activeSchoolIds: new Set(["a"]),
      states: [state("a", { status: "NON_COMPLIANT", compliantSince: null, flags: ["PENDING"] })],
      todayKey: TODAY,
    });
    expect(plan.upserts[0]).toMatchObject({ status: "COMPLIANT", compliantSince: TODAY });
    expect(plan.events).toEqual([
      { schoolId: "a", dateKey: TODAY, fromStatus: "NON_COMPLIANT", toStatus: "COMPLIANT", flags: [] },
    ]);
  });

  it("a school with no active year is not evaluated", () => {
    const plan = planComplianceChanges({
      rows: [row("a", { sy_start: null, enrollments: 0 })],
      activeSchoolIds: new Set(["a"]),
      states: [],
      todayKey: TODAY,
    });
    expect(plan.upserts[0].status).toBe("NOT_EVALUATED");
  });

  it("ignores inactive schools", () => {
    const plan = planComplianceChanges({
      rows: [row("a"), row("gone", { pending: 1 })],
      activeSchoolIds: new Set(["a"]),
      states: [],
      todayKey: TODAY,
    });
    expect(plan.upserts.map((u) => u.schoolId)).toEqual(["a"]);
  });
});
