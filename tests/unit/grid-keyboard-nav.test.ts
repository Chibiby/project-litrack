import { describe, expect, it } from "vitest";
import { nextGridCell } from "@/components/forms/grid-keyboard-nav";

/**
 * One case per row of the doc table in grid-keyboard-nav.ts. A 3x3 grid gives
 * both edges and a non-edge position for every key; a separate 1x1 grid
 * confirms every direction is an edge simultaneously.
 */

const SIZE = { rows: 3, cols: 3 };
const MID = { row: 1, col: 1 };

describe("nextGridCell", () => {
  it("Enter, no shift, last row -> null", () => {
    expect(nextGridCell("Enter", false, { row: 2, col: 1 }, SIZE)).toBeNull();
  });

  it("Enter, no shift, otherwise -> row + 1", () => {
    expect(nextGridCell("Enter", false, MID, SIZE)).toEqual({ row: 2, col: 1 });
  });

  it("Enter, shift, first row -> null", () => {
    expect(nextGridCell("Enter", true, { row: 0, col: 1 }, SIZE)).toBeNull();
  });

  it("Enter, shift, otherwise -> row - 1", () => {
    expect(nextGridCell("Enter", true, MID, SIZE)).toEqual({ row: 0, col: 1 });
  });

  it("ArrowDown, last row -> null", () => {
    expect(nextGridCell("ArrowDown", false, { row: 2, col: 1 }, SIZE)).toBeNull();
  });

  it("ArrowDown, otherwise -> row + 1", () => {
    expect(nextGridCell("ArrowDown", false, MID, SIZE)).toEqual({ row: 2, col: 1 });
  });

  it("ArrowUp, first row -> null", () => {
    expect(nextGridCell("ArrowUp", false, { row: 0, col: 1 }, SIZE)).toBeNull();
  });

  it("ArrowUp, otherwise -> row - 1", () => {
    expect(nextGridCell("ArrowUp", false, MID, SIZE)).toEqual({ row: 0, col: 1 });
  });

  it("ArrowLeft, first col -> null", () => {
    expect(nextGridCell("ArrowLeft", false, { row: 1, col: 0 }, SIZE)).toBeNull();
  });

  it("ArrowLeft, otherwise -> col - 1", () => {
    expect(nextGridCell("ArrowLeft", false, MID, SIZE)).toEqual({ row: 1, col: 0 });
  });

  it("ArrowRight, last col -> null", () => {
    expect(nextGridCell("ArrowRight", false, { row: 1, col: 2 }, SIZE)).toBeNull();
  });

  it("ArrowRight, otherwise -> col + 1", () => {
    expect(nextGridCell("ArrowRight", false, MID, SIZE)).toEqual({ row: 1, col: 2 });
  });

  it("a non-navigation key -> null", () => {
    expect(nextGridCell("Tab", false, MID, SIZE)).toBeNull();
    expect(nextGridCell("a", false, MID, SIZE)).toBeNull();
  });

  it("shift is irrelevant to non-Enter keys (ArrowDown with shiftKey behaves the same)", () => {
    expect(nextGridCell("ArrowDown", true, MID, SIZE)).toEqual({ row: 2, col: 1 });
  });

  describe("a 1x1 grid: every direction is an edge", () => {
    const ONE = { rows: 1, cols: 1 };
    const ONLY = { row: 0, col: 0 };

    it("Enter, no shift -> null (only row is also the last row)", () => {
      expect(nextGridCell("Enter", false, ONLY, ONE)).toBeNull();
    });

    it("Enter, shift -> null (only row is also the first row)", () => {
      expect(nextGridCell("Enter", true, ONLY, ONE)).toBeNull();
    });

    it("ArrowDown -> null", () => {
      expect(nextGridCell("ArrowDown", false, ONLY, ONE)).toBeNull();
    });

    it("ArrowUp -> null", () => {
      expect(nextGridCell("ArrowUp", false, ONLY, ONE)).toBeNull();
    });

    it("ArrowLeft -> null", () => {
      expect(nextGridCell("ArrowLeft", false, ONLY, ONE)).toBeNull();
    });

    it("ArrowRight -> null", () => {
      expect(nextGridCell("ArrowRight", false, ONLY, ONE)).toBeNull();
    });
  });
});
