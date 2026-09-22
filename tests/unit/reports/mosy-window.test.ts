import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MOSY_TERM, resolveMosyWindow } from "@/lib/reports/mosy-window";

/**
 * MOSY ("Middle of School Year") is the school year's Second Term window.
 * These assert it is derived from the same term-window code the End of Terms
 * sheet uses (not a parallel calculation), and that a School Head's override
 * moves it.
 *
 * `resolveMosyWindow` is a thin wrapper over `getTermWindows`, so it inherits
 * that function's timezone behaviour by design. `getTermWindows` reads the
 * anchor month off the stored UTC instant, so the window is the same in every
 * process timezone.
 *
 * An earlier revision of this file asserted the opposite — that a UTC process
 * timezone shifts the window a month early — using a fixture built from local
 * year/month/day fields. That fixture was not database-shaped: the app writes
 * `SchoolYear.startDate` as `new Date("YYYY-MM-DD")`, i.e. UTC midnight, so a
 * school year starting August 1 is `2026-08-01T00:00:00.000Z`. The fixtures
 * below match what the database actually holds.
 */

/** August 2026 start — mirrors the mock used in tests/unit/terms/windows.test.ts. */
const AUGUST_START = new Date("2026-08-01");
/** June 2026 start — a school on the older DepEd calendar. */
const JUNE_START = new Date("2026-06-15");

describe("MOSY_TERM", () => {
  it("names the Second Term", () => {
    expect(MOSY_TERM).toBe("SECOND");
  });
});

describe("resolveMosyWindow", () => {
  it("resolves the August-start school year's Second Term window", () => {
    const window = resolveMosyWindow(AUGUST_START);

    expect(window).toEqual({
      startKey: "2026-11-01",
      endKey: "2027-01-31",
      label: "November - January",
    });
  });

  it("resolves a different, correct window for a June-start school year", () => {
    const window = resolveMosyWindow(JUNE_START);

    expect(window).toEqual({
      startKey: "2026-09-01",
      endKey: "2026-11-30",
      label: "September - November",
    });
  });

  it("moves with a TermWindowOverride on the Second Term", () => {
    const window = resolveMosyWindow(AUGUST_START, [
      {
        term: "SECOND",
        startKey: "2026-11-15",
        endKey: "2027-02-10",
        deadlineKey: "2027-02-17",
      },
    ]);

    expect(window).toEqual({
      startKey: "2026-11-15",
      endKey: "2027-02-10",
      label: "November - February",
    });
  });

  describe("under a UTC process timezone", () => {
    const originalTz = process.env.TZ;

    beforeEach(() => {
      process.env.TZ = "UTC";
    });

    afterEach(() => {
      process.env.TZ = originalTz;
    });

    it("resolves the same window a non-UTC process timezone does", () => {
      // The regression guard. `2026-08-01T00:00:00.000Z` is what an August 1
      // school-year start is actually stored as: `createSchoolYear` writes
      // `new Date("2026-08-01")`, and ECMA-262 parses a date-only ISO string
      // as UTC midnight. `getTermWindows` reads the anchor month with UTC
      // getters, so this must match the November - January window the cases
      // above resolve under the suite's own timezone (UTC+8 on the project
      // owner's machine).
      //
      // Reading LOCAL fields instead — as the code did before — returned
      // October - December here, because on a negative-offset runtime that
      // instant's local date is July 31. `deadlineKey` drives `isTermLocked`,
      // so that discrepancy changed when teachers could encode grades.
      const window = resolveMosyWindow(new Date("2026-08-01T00:00:00.000Z"));

      expect(window).toEqual({
        startKey: "2026-11-01",
        endKey: "2027-01-31",
        label: "November - January",
      });
    });
  });
});
