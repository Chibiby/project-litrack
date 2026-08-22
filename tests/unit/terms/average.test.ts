import { describe, expect, it } from "vitest";
import { generalAverage } from "@/lib/terms/average";

/**
 * The General Average is computed on read and never stored, so this one function
 * is the only definition of it — the grid and the Excel export both call it. What
 * matters is that a partly filled row averages over the cells a teacher actually
 * encoded, and that the number rendered is the number exported.
 */

/** A full JHS row: the mock's 8 learning areas. */
const FULL_ROW = [90, 85, 88, 92, 87, 91, 89, 86];
/** An unencoded row: 8 empty cells. */
const EMPTY_ROW = [null, null, null, null, null, null, null, null];

describe("generalAverage", () => {
  it("averages a full row over all eight cells", () => {
    // 708 / 8
    expect(generalAverage(FULL_ROW)).toBe(88.5);
  });

  it("averages the filled cells only, not the eight columns", () => {
    // Two encoded cells out of eight: the mean is 87.5, not 708-style /8 (21.88).
    expect(generalAverage([90, 85, null, null, null, null, null, null])).toBe(87.5);
    // Padding a row with empty cells cannot move its average.
    expect(generalAverage([90, 85])).toBe(
      generalAverage([90, 85, null, null, null, null, null, null])
    );
  });

  it("rounds to two decimals", () => {
    expect(generalAverage([85, 90, 93])).toBe(89.33); // 268/3 = 89.333…
    expect(generalAverage([85, 90, 94])).toBe(89.67); // 269/3 = 89.666…
    expect(generalAverage([90, 91])).toBe(90.5);
    expect(generalAverage([60, 61, 63])).toBe(61.33);
  });

  it("returns null when every cell is empty", () => {
    expect(generalAverage(EMPTY_ROW)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(generalAverage([])).toBeNull();
  });

  it("treats null and undefined alike as empty cells", () => {
    expect(generalAverage([undefined, undefined])).toBeNull();
    expect(generalAverage([90, undefined, null, 80])).toBe(85);
    expect(generalAverage([90, null, 80])).toBe(generalAverage([90, undefined, 80]));
  });

  it("returns the value itself for a single filled cell", () => {
    expect(generalAverage([null, 77, null, undefined])).toBe(77);
    // A floor score is a real score, not an absent one.
    expect(generalAverage([60, null, null])).toBe(60);
  });
});
