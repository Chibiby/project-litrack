import { describe, expect, it } from "vitest";
import { MONTH_PICKER_HISTORY, monthPickerKeys } from "@/lib/month-range";
import {
  formatWeekOption,
  WEEK_PICKER_HISTORY,
  weekPickerKeys,
} from "@/lib/week-range";

/**
 * The ARAL grids pick their period from a dropdown rather than a date input, so
 * the list of options has become load-bearing: a `<Select>` whose value matches
 * no item renders an empty trigger, which would leave a teacher looking at a
 * blank box and unable to tell which week the rows below belong to.
 *
 * These assert the two properties the panels rely on — newest first, and the
 * period on screen is always in the list, however far prev/next has walked.
 */

describe("weekPickerKeys", () => {
  it("lists the anchor week first, then the weeks before it", () => {
    expect(weekPickerKeys("2026-09-07", 3)).toEqual([
      "2026-09-07",
      "2026-08-31",
      "2026-08-24",
      "2026-08-17",
    ]);
  });

  it("offers count + 1 weeks, the anchor included", () => {
    expect(weekPickerKeys("2026-09-07", WEEK_PICKER_HISTORY)).toHaveLength(
      WEEK_PICKER_HISTORY + 1
    );
  });

  it("snaps a mid-week anchor back to its Monday", () => {
    expect(weekPickerKeys("2026-09-10", 1)).toEqual(["2026-09-07", "2026-08-31"]);
  });

  it("keeps a future week in the list, at the top", () => {
    const keys = weekPickerKeys("2026-09-07", 2, "2026-09-28");
    expect(keys[0]).toBe("2026-09-28");
    expect(keys).toHaveLength(4);
  });

  it("keeps a week older than the history in the list, at the bottom", () => {
    const keys = weekPickerKeys("2026-09-07", 2, "2026-01-05");
    expect(keys.at(-1)).toBe("2026-01-05");
    expect(keys).toHaveLength(4);
  });

  it("does not duplicate a week the span already covers", () => {
    expect(weekPickerKeys("2026-09-07", 2, "2026-09-02")).toEqual([
      "2026-09-07",
      "2026-08-31",
      "2026-08-24",
    ]);
  });

  it("labels a week the way a teacher names it", () => {
    expect(formatWeekOption("2026-09-07")).toBe(
      "Week of September 7 – September 13, 2026"
    );
  });
});

describe("monthPickerKeys", () => {
  it("lists the anchor month first, then the months before it", () => {
    expect(monthPickerKeys("2026-09-01", 3)).toEqual([
      "2026-09-01",
      "2026-08-01",
      "2026-07-01",
      "2026-06-01",
    ]);
  });

  it("offers count + 1 months, the anchor included", () => {
    expect(monthPickerKeys("2026-09-01", MONTH_PICKER_HISTORY)).toHaveLength(
      MONTH_PICKER_HISTORY + 1
    );
  });

  it("crosses New Year without losing a month", () => {
    expect(monthPickerKeys("2026-02-01", 2)).toEqual([
      "2026-02-01",
      "2026-01-01",
      "2025-12-01",
    ]);
  });

  it("snaps a mid-month anchor and include key back to the 1st", () => {
    expect(monthPickerKeys("2026-09-10", 1, "2026-11-24")).toEqual([
      "2026-11-01",
      "2026-09-01",
      "2026-08-01",
    ]);
  });
});
