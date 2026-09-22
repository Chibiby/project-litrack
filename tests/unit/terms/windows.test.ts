import { describe, expect, it } from "vitest";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import {
  TERM_PERIODS,
  getTermWindows,
  isTermLocked,
  resolveTermWindow,
  validateTermWindows,
} from "@/lib/terms/windows";

/**
 * Term windows are *derived* from the active school year's start month rather
 * than hardcoded, and locking is a string comparison on local date keys. These
 * assert the three properties everything downstream depends on: the windows are
 * three whole months snapped to month boundaries, the derivation follows the
 * school year instead of the calendar year, and no `Date`/UTC arithmetic can
 * move a boundary by a day.
 */

/**
 * These fixtures are DATABASE-SHAPED on purpose: `new Date("2026-08-01")`,
 * not `new Date(2026, 7, 1)`.
 *
 * `createSchoolYear` stores the value of an `<input type="date">` via
 * `new Date("YYYY-MM-DD")`, and ECMA-262 parses a date-only ISO string as UTC
 * midnight, so a school year starting August 1 is `2026-08-01T00:00:00.000Z`.
 * The school-year pages round-trip it with `.toISOString().slice(0, 10)`.
 *
 * Building a fixture from local year/month/day fields instead produces a
 * different instant on any machine that is not at UTC (on UTC+8 it is
 * `2026-07-31T16:00:00.000Z`), which is a value this app never writes. Such a
 * fixture masked a real defect: `getTermWindows` read the anchor month with
 * local getters, which agreed with the UTC ones at UTC and at positive
 * offsets but landed a day — and therefore a month — early at negative ones.
 */
/** August 2026 start — the mock's school year. */
const AUGUST_START = new Date("2026-08-01");
/** June 2026 start — a school on the older DepEd calendar. */
const JUNE_START = new Date("2026-06-15");

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
    const [first] = getTermWindows(new Date("2027-12-01"));
    expect(first.rangeLabel).toBe("December - February");
    expect(first.endKey).toBe("2028-02-29");
  });

  it("reads the start month off the stored UTC instant, in any process timezone", () => {
    // This test previously asserted the opposite — that the month is read
    // from LOCAL fields — on the premise that `SchoolYear.startDate` holds
    // local midnight. It does not. `createSchoolYear` writes
    // `new Date("2026-08-01")`, which is `2026-08-01T00:00:00.000Z`, and the
    // school-year pages read it back with `.toISOString().slice(0, 10)`. Were
    // the premise true, that round-trip would display "2026-07-31" on a UTC+8
    // machine for a year the user entered as August 1.
    //
    // Reading local fields happened to agree at UTC (production) and at
    // positive offsets, and shifted every window — and every `deadlineKey`
    // that `isTermLocked` consults — a month early at negative ones.
    const stored = new Date("2026-08-01T00:00:00.000Z");
    expect(getTermWindows(stored)[0].startKey).toBe("2026-08-01");
    expect(getTermWindows(stored)[0].rangeLabel).toBe("August - October");

    // Stated timezone-independently: every instant inside UTC August derives
    // the same windows as the month's first instant.
    const midMonth = new Date("2026-08-15T23:30:00.000Z");
    const lastInstant = new Date("2026-08-31T23:59:59.999Z");
    expect(getTermWindows(stored)).toEqual(getTermWindows(midMonth));
    expect(getTermWindows(stored)).toEqual(getTermWindows(lastInstant));
  });

  it("derives the same windows on a negative-offset runtime", () => {
    // The discriminating case. At UTC and at positive offsets, reading the
    // anchor month from local fields and from UTC fields give the same
    // answer, so neither a UTC nor a Manila test can catch this regression —
    // only a negative offset can. A developer in the Americas previously saw
    // every window, and every `deadlineKey` that `isTermLocked` consults,
    // land a month early: "July - September" for an August-start year.
    const originalTz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const windows = getTermWindows(new Date("2026-08-01T00:00:00.000Z"));
      expect(windows.map((w) => w.rangeLabel)).toEqual([
        "August - October",
        "November - January",
        "February - April",
      ]);
      expect(windows[0].startKey).toBe("2026-08-01");
      expect(windows[2].deadlineKey).toBe("2027-04-30");
    } finally {
      process.env.TZ = originalTz;
    }
  });

  it("returns one window per term period, in chronological order", () => {
    const windows = getTermWindows(AUGUST_START);
    expect(windows.map((w) => w.term)).toEqual([...TERM_PERIODS]);
    expect(windows[0].startKey < windows[1].startKey).toBe(true);
    expect(windows[1].startKey < windows[2].startKey).toBe(true);
  });

  it("labels ranges without years, so a term reads the same in any school year", () => {
    expect(getTermWindows(new Date("2030-08-01")).map((w) => w.rangeLabel)).toEqual(
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

describe("getTermWindows with overrides", () => {
  it("derives a deadline equal to the month end when nothing is overridden", () => {
    const windows = getTermWindows(AUGUST_START);

    expect(windows.map((w) => w.deadlineKey)).toEqual([
      "2026-10-31",
      "2027-01-31",
      "2027-04-30",
    ]);
    expect(windows.every((w) => w.deadlineKey === w.endKey)).toBe(true);
    expect(windows.every((w) => w.isOverridden === false)).toBe(true);
  });

  it("replaces only the term it names, leaving the other two derived", () => {
    const windows = getTermWindows(AUGUST_START, [
      {
        term: "SECOND",
        startKey: "2026-11-01",
        endKey: "2027-01-31",
        deadlineKey: "2027-02-28",
      },
    ]);

    expect(windows[0]).toMatchObject({
      term: "FIRST",
      startKey: "2026-08-01",
      endKey: "2026-10-31",
      deadlineKey: "2026-10-31",
      isOverridden: false,
    });
    expect(windows[1]).toMatchObject({
      term: "SECOND",
      endKey: "2027-01-31",
      deadlineKey: "2027-02-28",
      isOverridden: true,
    });
    expect(windows[2]).toMatchObject({ term: "THIRD", isOverridden: false });
  });

  it("relabels the range when an override moves the months", () => {
    const [first] = getTermWindows(AUGUST_START, [
      {
        term: "FIRST",
        startKey: "2026-08-01",
        endKey: "2026-09-30",
        deadlineKey: "2026-09-30",
      },
    ]);

    expect(first.rangeLabel).toBe("August - September");
  });

  it("ignores an override naming a term that does not exist", () => {
    const windows = getTermWindows(AUGUST_START, [
      {
        term: "FOURTH" as never,
        startKey: "2027-05-01",
        endKey: "2027-07-31",
        deadlineKey: "2027-07-31",
      },
    ]);

    expect(windows).toHaveLength(3);
    expect(windows.every((w) => w.isOverridden === false)).toBe(true);
  });
});

describe("isTermLocked reads the deadline, not the months", () => {
  const extended = getTermWindows(JUNE_START, [
    {
      term: "FIRST",
      startKey: "2026-06-01",
      endKey: "2026-08-31",
      deadlineKey: "2026-09-30",
    },
  ]);

  it("keeps a term open past its last month when the deadline was extended", () => {
    // The months ended Aug 31; the head moved entry to Sept 30.
    expect(isTermLocked(extended[0], "2026-09-15")).toBe(false);
  });

  it("locks on the day after the deadline, not the day after the months", () => {
    expect(isTermLocked(extended[0], "2026-09-30")).toBe(false);
    expect(isTermLocked(extended[0], "2026-10-01")).toBe(true);
  });

  it("still locks a derived term the day after its months end", () => {
    const [first] = getTermWindows(JUNE_START);
    expect(isTermLocked(first, "2026-08-31")).toBe(false);
    expect(isTermLocked(first, "2026-09-01")).toBe(true);
  });
});

describe("validateTermWindows", () => {
  const YEAR_START = "2026-06-01";
  const YEAR_END = "2027-03-31";

  it("accepts the derived windows of the year it was derived from", () => {
    const windows = getTermWindows(JUNE_START);
    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toBeNull();
  });

  it("rejects a term that ends before it starts", () => {
    const windows = getTermWindows(JUNE_START, [
      {
        term: "FIRST",
        startKey: "2026-08-01",
        endKey: "2026-06-30",
        deadlineKey: "2026-08-01",
      },
    ]);

    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toMatch(
      /First Term ends before it starts/
    );
  });

  it("rejects a deadline that falls before its own term ends", () => {
    const windows = getTermWindows(JUNE_START, [
      {
        term: "FIRST",
        startKey: "2026-06-01",
        endKey: "2026-08-31",
        deadlineKey: "2026-07-15",
      },
    ]);

    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toMatch(
      /First Term's deadline is before/
    );
  });

  it("rejects overlapping months across two terms", () => {
    const windows = getTermWindows(JUNE_START, [
      {
        term: "FIRST",
        startKey: "2026-06-01",
        endKey: "2026-09-30",
        deadlineKey: "2026-09-30",
      },
    ]);

    // Derived SECOND starts 2026-09-01, so FIRST now runs past it.
    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toMatch(
      /Second Term starts before First Term ends/
    );
  });

  it("allows a deadline to run past the next term's start", () => {
    const windows = getTermWindows(JUNE_START, [
      {
        term: "FIRST",
        startKey: "2026-06-01",
        endKey: "2026-08-31",
        deadlineKey: "2026-10-15",
      },
    ]);

    // The whole point of a separate deadline: entry stays open into Term 2.
    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toBeNull();
  });

  it("rejects months that start before the school year does", () => {
    const windows = getTermWindows(JUNE_START, [
      {
        term: "FIRST",
        startKey: "2026-05-01",
        endKey: "2026-08-31",
        deadlineKey: "2026-08-31",
      },
    ]);

    expect(validateTermWindows(windows, YEAR_START, "2027-05-31")).toMatch(
      /First Term starts before the school year/
    );
  });
});
