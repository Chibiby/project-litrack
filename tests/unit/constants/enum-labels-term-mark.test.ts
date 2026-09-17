import { describe, expect, it } from "vitest";
import { TermMark } from "@prisma/client";
import {
  TERM_MARK_LABELS,
  TERM_MARK_OPTIONS,
  TERM_MARK_SHORT_LABELS,
} from "@/lib/constants/enum-labels";

/**
 * `TERM_MARK_LABELS`/`TERM_MARK_SHORT_LABELS` back the Grade 1 letter-mark
 * picker and every mark cell's export/report text (`termMarkText` in
 * `src/lib/terms/grading-scale.ts`). A mark with no label renders the raw
 * enum constant to a teacher or in a downloaded workbook.
 */
describe("TERM_MARK_LABELS", () => {
  it("covers every TermMark value with a full-word label", () => {
    const missing = Object.values(TermMark).filter((mark) => !(mark in TERM_MARK_LABELS));
    expect(missing).toEqual([]);
  });

  it("covers every TermMark value with a one-letter short code", () => {
    const missing = Object.values(TermMark).filter(
      (mark) => !(mark in TERM_MARK_SHORT_LABELS)
    );
    expect(missing).toEqual([]);
  });
});

describe("TERM_MARK_OPTIONS", () => {
  it("is ordered A through E", () => {
    expect(TERM_MARK_OPTIONS.map((o) => o.short)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("names every TermMark value exactly once", () => {
    expect(TERM_MARK_OPTIONS.map((o) => o.value).sort()).toEqual(
      [...Object.values(TermMark)].sort()
    );
  });

  it("pairs each option's short code and label with the canonical maps", () => {
    for (const option of TERM_MARK_OPTIONS) {
      expect(option.short).toBe(TERM_MARK_SHORT_LABELS[option.value]);
      expect(option.label).toBe(TERM_MARK_LABELS[option.value]);
    }
  });
});
