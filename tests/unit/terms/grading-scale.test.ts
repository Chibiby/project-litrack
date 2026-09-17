import { describe, expect, it } from "vitest";
import { TermMark } from "@prisma/client";
import {
  rowGeneralAverage,
  termCellText,
  termGradingScale,
  termMarkText,
} from "@/lib/terms/grading-scale";

/**
 * `termGradingScale` is the single place "which grades use letters" is
 * decided — the grid, the save action, the sheet figures and both exports all
 * ask here. These tests pin the Grade 1 letter-mark decision directly, so a
 * later "just add G2 too" or "flip the set" change is caught here first.
 */

describe("termGradingScale", () => {
  it("is LETTER for Grade 1", () => {
    expect(termGradingScale("G1")).toBe("LETTER");
  });

  it("is NUMERIC for every other term-sheet grade", () => {
    for (const type of ["KINDER", "G2", "G3", "G7", "G12", "FLOATING"]) {
      expect(termGradingScale(type)).toBe("NUMERIC");
    }
  });
});

describe("termMarkText", () => {
  it("renders the short code, an en dash, then the full word", () => {
    // The en dash (–) is deliberate — not a hyphen. DepEd's paper form
    // and the sheet's own column both use it.
    expect(termMarkText(TermMark.ADVANCING)).toBe("A – Advancing");
    expect(termMarkText(TermMark.BENCHMARKING)).toBe("B – Benchmarking");
    expect(termMarkText(TermMark.CONNECTING)).toBe("C – Connecting");
    expect(termMarkText(TermMark.DEVELOPING)).toBe("D – Developing");
    expect(termMarkText(TermMark.EMERGING)).toBe("E – Emerging");
  });
});

describe("termCellText", () => {
  it("shows the full mark label when a cell holds a mark", () => {
    expect(termCellText({ score: null, mark: TermMark.ADVANCING })).toBe(
      "A – Advancing"
    );
  });

  it("shows the plain number when a cell holds a score", () => {
    expect(termCellText({ score: 87, mark: null })).toBe("87");
  });

  it("is blank when a cell holds neither", () => {
    expect(termCellText({ score: null, mark: null })).toBe("");
  });

  it("prefers the mark when a row somehow carries both", () => {
    // Should never happen (the DB CHECK forbids it), but the reader still has
    // to pick one deterministically rather than concatenate garbage.
    expect(termCellText({ score: 87, mark: TermMark.EMERGING })).toBe(
      "E – Emerging"
    );
  });
});

describe("rowGeneralAverage", () => {
  it("is null for a Grade 1 row even when every cell still holds a legacy numeric score", () => {
    // A LETTER-scale grade never shows a General Average, not even over
    // scores saved before the grade switched to marks.
    const cells = [
      { score: 90, mark: null },
      { score: 85, mark: null },
    ];
    expect(rowGeneralAverage("G1", cells)).toBeNull();
  });

  it("is null for a non-G1 row that holds any mark cell", () => {
    const cells = [
      { score: 90, mark: null },
      { score: null, mark: TermMark.CONNECTING },
    ];
    expect(rowGeneralAverage("G3", cells)).toBeNull();
  });

  it("matches generalAverage for a non-G1 row of plain numbers", () => {
    const cells = [
      { score: 80, mark: null },
      { score: 90, mark: null },
      { score: null, mark: null },
    ];
    // (80 + 90) / 2 — the blank cell is "not encoded", not a zero.
    expect(rowGeneralAverage("G3", cells)).toBe(85);
  });

  it("treats a missing/undefined cell the same as a filled-in null cell", () => {
    expect(rowGeneralAverage("G3", [{ score: 80, mark: null }, null, undefined])).toBe(
      80
    );
  });
});
