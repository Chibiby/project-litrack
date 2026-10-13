import { describe, expect, it, vi } from "vitest";
import { addDays, formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";
import { resolveMosyWindow } from "@/lib/reports/mosy-window";
import { scopeRaw } from "@/lib/summary/scoped-raw";
import type { ScopeSchool } from "@/lib/summary/types";

/**
 * MOSY in Non-compliance: MOSY only counts once the active school year's MOSY
 * (Second Term) window has started, honouring a School Head's override, and
 * every flag's reason reaches the table (cellNotes) and the lists' Why column.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

const { isMosyDue, shapeCompliance } = await import("@/lib/summary/queries/compliance");
type RawComplianceRow = import("@/lib/summary/queries/compliance").RawComplianceRow;

const YEAR_START = "2026-06-01T00:00:00.000Z";
const MOSY_START = resolveMosyWindow(new Date(YEAR_START)).startKey;
const shift = (key: string, days: number) => formatLocalDateKey(addDays(parseLocalDateKey(key), days));

/** A healthy school whose ARAL learners have the given MOSY counts. */
function rawRow(mosy: { notUpdated: number; forDecision: number }, extra: Partial<RawComplianceRow> = {}): RawComplianceRow {
  return {
    school_id: "s1",
    live: 10,
    non_archived: 10,
    pending: 0,
    grades_no_adviser: 0,
    aral: 5,
    incomplete: 0,
    enrollments: 10,
    drift: 0,
    last_attendance: "2099-01-01",
    reading: 5,
    last_week: 5,
    has_admin: true,
    mosy_not_updated: mosy.notUpdated,
    mosy_for_decision: mosy.forDecision,
    sy_start: YEAR_START,
    mosy_override_start: null,
    mosy_override_end: null,
    mosy_override_deadline: null,
    ...extra,
  };
}

const SCHOOL: ScopeSchool = {
  id: "s1",
  name: "Alabel CES",
  schoolIdCode: "1",
  district: "Alabel 1",
  division: null,
  region: null,
  isActive: true,
};

describe("isMosyDue", () => {
  it("is due from the first day of the MOSY window, not the day before", () => {
    expect(isMosyDue(rawRow({ notUpdated: 1, forDecision: 0 }), MOSY_START)).toBe(true);
    expect(isMosyDue(rawRow({ notUpdated: 1, forDecision: 0 }), shift(MOSY_START, -1))).toBe(false);
  });

  it("follows a School Head's Second Term override", () => {
    const lateStart = shift(MOSY_START, 20);
    const row = rawRow(
      { notUpdated: 1, forDecision: 0 },
      { mosy_override_start: lateStart, mosy_override_end: "2099-12-31", mosy_override_deadline: "2099-12-31" }
    );
    expect(isMosyDue(row, MOSY_START)).toBe(false);
    expect(isMosyDue(row, lateStart)).toBe(true);
  });

  it("is never due for a school with no active school year", () => {
    expect(isMosyDue(rawRow({ notUpdated: 1, forDecision: 0 }, { sy_start: null }), MOSY_START)).toBe(false);
  });
});

describe("shapeCompliance: reasons reach the table and the lists", () => {
  function shape(row: RawComplianceRow, level: "school" | "overall", todayKey = MOSY_START) {
    return shapeCompliance({
      raw: scopeRaw("compliance", [row], [SCHOOL]),
      schools: [SCHOOL],
      level,
      todayKey,
      computedAt: "x",
    });
  }

  it("prints each MOSY reason under its cell at school level and in the Why column", () => {
    const result = shape(rawRow({ notUpdated: 5, forDecision: 2 }), "school");
    expect(result.sections[0]!.cellNotes).toEqual({
      "school:s1": {
        PENDING: ["2 ARAL learners wait for a MOSY stay or move-out decision"],
        NOT_UPDATED: ["5 ARAL learners have no MOSY update"],
      },
    });
    const notUpdated = result.lists.find((l) => l.id === "NOT_UPDATED")!;
    expect(notUpdated.rows).toEqual([["Alabel CES", "1", "Alabel 1", "5 ARAL learners have no MOSY update"]]);
  });

  it("raises no MOSY flag before the window starts", () => {
    const result = shape(rawRow({ notUpdated: 5, forDecision: 2 }), "school", shift(MOSY_START, -1));
    expect(result.sections[0]!.cellNotes).toEqual({});
    expect(result.lists.find((l) => l.id === "NOT_UPDATED")!.rows).toEqual([]);
  });

  it("adds no cell notes above school level, where a row sums several schools", () => {
    const result = shape(rawRow({ notUpdated: 5, forDecision: 0 }), "overall");
    expect(result.sections[0]!.cellNotes).toBeUndefined();
  });
});
