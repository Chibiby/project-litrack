import { describe, expect, it } from "vitest";
import { scopeRaw } from "@/lib/summary/scoped-raw";
import type { RawComplianceRow } from "@/lib/summary/queries/compliance";
import {
  shapeFullCompliance,
  type RawFullComplianceRow,
} from "@/lib/summary/queries/full-compliance";
import type { ScopeSchool } from "@/lib/summary/types";

const TODAY = "2026-11-24";

function school(id: string, district: string | null): ScopeSchool {
  return {
    id,
    name: `School ${id.toUpperCase()}`,
    schoolIdCode: `1000${id}`,
    district,
    division: "Div",
    region: "R",
    isActive: true,
  };
}

/** Zero flags on TODAY unless overridden. */
function base(schoolId: string, over: Partial<RawComplianceRow> = {}): RawComplianceRow {
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

function raw(
  schoolId: string,
  compliantSince: string | null,
  over: Partial<RawComplianceRow> = {},
  events: RawFullComplianceRow["events"] = []
): RawFullComplianceRow {
  return { ...base(schoolId, over), compliant_since: compliantSince, tracking_since: "2026-09-01", events };
}

function shape(rows: RawFullComplianceRow[], schools: ScopeSchool[]) {
  const result = shapeFullCompliance({
    raw: scopeRaw("full-compliance", rows, schools),
    schools,
    level: "school",
    todayKey: TODAY,
    computedAt: "2026-11-24T00:00:00.000Z",
  });
  return { result, view: result.fullCompliance! };
}

describe("shapeFullCompliance", () => {
  it("only scoped schools appear in every list", () => {
    const rows = [
      raw("a", "2026-09-01"),
      raw("x", "2026-09-01", {}, [{ dateKey: "2026-11-22", from: "NON_COMPLIANT", to: "COMPLIANT", flags: [] }]),
    ];
    const { result, view } = shape(rows, [school("a", "North")]);
    const ids = [
      ...view.directory,
      ...view.leaderboard,
      ...view.recognition,
      ...view.recent.map((r) => r.school),
      ...view.lost.map((r) => r.school),
    ].map((s) => s.schoolId);
    expect(new Set(ids)).toEqual(new Set(["a"]));
    expect(view.ranking.map((r) => r.district)).toEqual(["North"]);
    expect(result.exportList!.rows.map((r) => r[0])).toEqual(["School A"]);
  });

  it("rate = compliant schools / active schools", () => {
    const schools = [school("a", "N"), school("b", "N"), school("c", "N"), school("d", "N")];
    const { view } = shape(
      [raw("a", "2026-09-01"), raw("b", "2026-11-20"), raw("c", null, { pending: 1 }), raw("d", null, { live: 0 })],
      schools
    );
    expect(view.cards).toEqual({ total: 4, compliant: 2, consistent: 1, ratePct: 50 });
  });

  it("ranking orders by percent, then by size", () => {
    const schools = [school("a", "Big"), school("b", "Big"), school("c", "Small"), school("d", "Half"), school("e", "Half")];
    const { view } = shape(
      [raw("a", "2026-09-01"), raw("b", "2026-09-01"), raw("c", "2026-09-01"), raw("d", "2026-09-01"), raw("e", null, { pending: 1 })],
      schools
    );
    expect(view.ranking.map((r) => [r.district, r.compliant, r.total, r.pct])).toEqual([
      ["Big", 2, 2, 100],
      ["Small", 1, 1, 100],
      ["Half", 1, 2, 50],
    ]);
  });

  it("recent lists a school once, with its latest date; lost skips schools compliant again", () => {
    const flip: RawFullComplianceRow["events"] = [
      { dateKey: "2026-11-23", from: "NON_COMPLIANT", to: "COMPLIANT", flags: [] },
      { dateKey: "2026-11-21", from: "COMPLIANT", to: "NON_COMPLIANT", flags: ["PENDING"] },
      { dateKey: "2026-11-20", from: "NON_COMPLIANT", to: "COMPLIANT", flags: [] },
    ];
    const lostNow: RawFullComplianceRow["events"] = [
      { dateKey: "2026-11-22", from: "COMPLIANT", to: "NON_COMPLIANT", flags: ["INCOMPLETE"] },
    ];
    const old: RawFullComplianceRow["events"] = [
      { dateKey: "2026-11-10", from: "NON_COMPLIANT", to: "COMPLIANT", flags: [] },
    ];
    const { view } = shape(
      [raw("a", "2026-11-23", {}, flip), raw("b", null, { incomplete: 1 }, lostNow), raw("c", "2026-11-10", {}, old)],
      [school("a", "N"), school("b", "N"), school("c", "N")]
    );
    expect(view.recent.map((r) => [r.school.schoolId, r.dateKey])).toEqual([["a", "2026-11-23"]]);
    expect(view.lost.map((r) => [r.school.schoolId, r.dateKey, r.flags])).toEqual([["b", "2026-11-22", ["Incomplete"]]]);
  });

  it("leaderboard caps at 10 and sorts by streak, longest first", () => {
    const ids = "abcdefghijkl".split("");
    const schools = ids.map((id) => school(id, "N"));
    const rows = ids.map((id, i) => raw(id, `2026-10-${String(i + 1).padStart(2, "0")}`));
    const { view } = shape(rows, schools);
    expect(view.leaderboard).toHaveLength(10);
    expect(view.leaderboard[0].schoolId).toBe("a");
    expect(view.leaderboard.map((s) => s.streak)).toEqual([...view.leaderboard.map((s) => s.streak)].sort((x, y) => y! - x!));
  });

  it("recognition holds only consistently compliant schools", () => {
    const { view } = shape(
      [raw("a", "2026-09-01"), raw("b", "2026-11-20")],
      [school("a", "N"), school("b", "N")]
    );
    expect(view.recognition.map((s) => s.schoolId)).toEqual(["a"]);
  });

  it("exportList has one row per school with its status, streak and flags", () => {
    const { result } = shape(
      [raw("a", "2026-09-01"), raw("b", null, { pending: 1 })],
      [school("a", "N"), school("b", null)]
    );
    expect(result.exportList!.columns).toEqual(["School", "School ID", "District", "Status", "Streak (days)", "Flags"]);
    expect(result.exportList!.rows).toEqual([
      ["School A", "1000a", "N", "Consistently compliant", 85, ""],
      ["School B", "1000b", "No district", "Non-compliant", null, "Pending"],
    ]);
  });

  it("before the first daily check, schools show today's status with no streak", () => {
    const row = { ...raw("a", null), tracking_since: null };
    const { view } = shape([row], [school("a", "N")]);
    expect(view.directory[0]).toMatchObject({ status: "FULL", streak: null });
    expect(view.trackingSince).toBeNull();
  });
});
