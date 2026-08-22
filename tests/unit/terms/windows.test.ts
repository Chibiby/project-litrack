import { describe, expect, it } from "vitest";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import {
  TERM_PERIODS,
  getTermWindows,
  isTermLocked,
  resolveTermWindow,
} from "@/lib/terms/windows";

/**
 * Term windows are *derived* from the active school year's start month rather
 * than hardcoded, and locking is a string comparison on local date keys. These
 * assert the three properties everything downstream depends on: the windows are
 * three whole months snapped to month boundaries, the derivation follows the
 * school year instead of the calendar year, and no `Date`/UTC arithmetic can
 * move a boundary by a day.
 */

/** August 2026 start — the mock's school year. Local midnight, no UTC instant. */
const AUGUST_START = new Date(2026, 7, 1);
/** June 2026 start — a school on the older DepEd calendar. */
const JUNE_START = new Date(2026, 5, 15);

describe("getTermWindows", () => {
  it("derives the mock's three windows from an August-start school year", () => {
    const windows = getTermWindows(AUGUST_START);

    expect(windows).toHaveLength(3);
    expect(windows).toMatchObject([
      {
        term: "FIRST",
        label: "First Term",
        rangeLabel: "August - October",
        startKey: "2026-08-01",
        endKey: "2026-10-31",
      },
      {
        term: "SECOND",
        label: "Second Term",
        rangeLabel: "November - January",
        startKey: "2026-11-01",
        endKey: "2027-01-31",
      },
      {
        term: "THIRD",
        label: "Third Term",
        rangeLabel: "February - April",
        startKey: "2027-02-01",
        endKey: "2027-04-30",
      },
    ]);
  });

  it("snaps every window to whole-month boundaries", () => {
    // A term is three whole months: it starts on the 1st and ends on the last
    // calendar day of its third month — never three months minus a day, and
    // never a 30th in a 31-day month.
    for (const window of getTermWindows(AUGUST_START)) {
      expect(window.startKey.slice(8)).toBe("01");
    }

    const [first, second, third] = getTermWindows(AUGUST_START);
    expect(first.endKey).toBe("2026-10-31"); // 31-day month
    expect(second.endKey).toBe("2027-01-31");
    expect(third.endKey).toBe("2027-04-30"); // 30-day month

    // Contiguous: each window opens the day after the previous one closes.
    expect(second.startKey > first.endKey).toBe(true);
    expect(third.startKey > second.endKey).toBe(true);
  });

  it("derives June-start windows with no code change", () => {
    const windows = getTermWindows(JUNE_START);

    expect(windows).toMatchObject([
      {
        term: "FIRST",
        rangeLabel: "June - August",
        startKey: "2026-06-01",
        endKey: "2026-08-31",
      },
      {
        term: "SECOND",
        rangeLabel: "September - November",
        startKey: "2026-09-01",
        endKey: "2026-11-30",
      },
      {
        term: "THIRD",
        rangeLabel: "December - February",
        startKey: "2026-12-01",
        endKey: "2027-02-28",
      },
    ]);
  });

  it("rolls Term 3 into the next calendar year", () => {
    const [, , third] = getTermWindows(AUGUST_START);

    // The school year starts in 2026; Term 3 lives entirely in 2027. A window
    // built off the start date's calendar year alone would stay in 2026.
    expect(third.startKey.slice(0, 4)).toBe("2027");
    expect(third.endKey.slice(0, 7)).toBe("2027-04");
    expect(third.startKey.startsWith("2026")).toBe(false);
  });

  it("ends on the true last day of a leap February", () => {
    // December 2027 start: Term 1 is Dec-Feb, and February 2028 has 29 days.
    const [first] = getTermWindows(new Date(2027, 11, 1));
    expect(first.rangeLabel).toBe("December - February");
    expect(first.endKey).toBe("2028-02-29");
  });

  it("reads the start month from the local calendar, not a UTC instant", () => {
    // The UTC+8 trap. `SchoolYear.startDate` is a bare timestamp, and on a
    // UTC+8 runtime the very start of August 1 local is 2026-07-31T16:00Z — so
    // anything that reads the month off UTC fields (`toISOString().slice(0, 7)`,
    // `getUTCMonth()`) yields July and shifts every window a month early.
    const firstInstantOfAugust = new Date(2026, 7, 1, 0, 0, 0, 0);
    expect(getTermWindows(firstInstantOfAugust)[0].startKey).toBe("2026-08-01");
    expect(getTermWindows(firstInstantOfAugust)[0].rangeLabel).toBe("August - October");

    // Stated timezone-independently: every instant inside local August must
    // derive the same windows as the month's first instant.
    const midMonth = new Date(2026, 7, 15, 23, 30, 0, 0);
    const lastInstant = new Date(2026, 7, 31, 23, 59, 59, 999);
    expect(getTermWindows(firstInstantOfAugust)).toEqual(getTermWindows(midMonth));
    expect(getTermWindows(firstInstantOfAugust)).toEqual(getTermWindows(lastInstant));
  });

  it("returns one window per term period, in chronological order", () => {
    const windows = getTermWindows(AUGUST_START);
    expect(windows.map((w) => w.term)).toEqual([...TERM_PERIODS]);
    expect(windows[0].startKey < windows[1].startKey).toBe(true);
    expect(windows[1].startKey < windows[2].startKey).toBe(true);
  });

  it("labels ranges without years, so a term reads the same in any school year", () => {
    expect(getTermWindows(new Date(2030, 7, 1)).map((w) => w.rangeLabel)).toEqual(
      getTermWindows(AUGUST_START).map((w) => w.rangeLabel)
    );
  });
});

describe("isTermLocked", () => {
  const [first] = getTermWindows(AUGUST_START);

  it("keeps a term open through its last day and locks the day after", () => {
    expect(first.endKey).toBe("2026-10-31");
    expect(isTermLocked(first, "2026-10-30")).toBe(false);
    expect(isTermLocked(first, first.endKey)).toBe(false); // inclusive
    expect(isTermLocked(first, "2026-11-01")).toBe(true);
  });

  it("leaves a term that has not started yet unlocked", () => {
    const [, , third] = getTermWindows(AUGUST_START);
    expect(isTermLocked(third, "2026-08-15")).toBe(false);
    expect(isTermLocked(third, third.startKey)).toBe(false);
  });

  it("does not lock a term early at 01:00 Manila on its last day", () => {
    // 17:00 UTC Oct 30 is already 01:00 Oct 31 in Manila. `schoolToday` reports
    // the civil day the school is on, so a term ending Oct 31 is still open.
    const oneAmManila = new Date("2026-10-30T17:00:00Z");
    const todayKey = formatLocalDateKey(schoolToday(oneAmManila));

    expect(todayKey).toBe("2026-10-31");
    expect(isTermLocked(first, todayKey)).toBe(false);

    // The same instant's UTC calendar day is a different day — that mismatch is
    // exactly why today must come from `schoolToday()`, not `new Date()`.
    expect(oneAmManila.toISOString().slice(0, 10)).not.toBe(todayKey);
  });

  it("locks once Manila has rolled past the window's last day", () => {
    const oneAmNextMonth = new Date("2026-10-31T17:00:00Z"); // 01:00 Nov 1 Manila
    const todayKey = formatLocalDateKey(schoolToday(oneAmNextMonth));

    expect(todayKey).toBe("2026-11-01");
    expect(isTermLocked(first, todayKey)).toBe(true);
  });
});

describe("resolveTermWindow", () => {
  const windows = getTermWindows(AUGUST_START);

  it("returns the window matching a term", () => {
    for (const term of TERM_PERIODS) {
      const resolved = resolveTermWindow(windows, term);
      expect(resolved?.term).toBe(term);
      expect(resolved).toEqual(windows.find((w) => w.term === term));
    }
  });

  it("returns null for an unknown term string", () => {
    // A URL param is user input; an unrecognized value must not fall back to a
    // window the caller would then treat as unlocked.
    for (const bogus of ["FOURTH", "", "1", "QUARTER_1"]) {
      expect(resolveTermWindow(windows, bogus)).toBeNull();
    }
  });
});

describe("TERM_PERIODS", () => {
  it("lists the three terms in chronological order", () => {
    expect(TERM_PERIODS).toEqual(["FIRST", "SECOND", "THIRD"]);
  });
});
