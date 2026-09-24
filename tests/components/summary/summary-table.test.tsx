import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SummaryTable } from "@/components/summary/summary-table";
import type { SummaryGroup, SummarySection } from "@/lib/summary/types";

afterEach(cleanup);

function group(
  partial: Partial<SummaryGroup> & Pick<SummaryGroup, "key" | "label" | "base" | "cells">
): SummaryGroup {
  return { ...partial };
}

const genderSection: SummarySection = {
  id: "gender",
  title: "Gender",
  kind: "single",
  byGrade: false,
  buckets: [
    { id: "MALE", label: "Male" },
    { id: "FEMALE", label: "Female" },
  ],
  baseLabel: "% of learners",
  table: {
    groups: [
      group({
        key: "overall",
        label: "All schools",
        base: 8,
        cells: {
          MALE: { count: 1, base: 8, pct: 12.5 },
          FEMALE: { count: 7, base: 8, pct: 87.5 },
        },
      }),
      group({
        key: "school:empty",
        label: "Empty Elementary",
        base: 0,
        cells: {
          MALE: { count: 0, base: 0, pct: null },
          FEMALE: { count: 0, base: 0, pct: null },
        },
      }),
    ],
  },
};

const profileSection: SummarySection = {
  id: "englishProfile",
  title: "English reading profile",
  kind: "single",
  byGrade: true,
  buckets: [
    { id: "INDEPENDENT", label: "Independent" },
    { id: "NOT_COLLECTED", label: "Not collected for this grade" },
  ],
  baseLabel: "% of learners in the grade",
  table: {
    groups: [
      group({
        key: "overall|G1",
        label: "All schools",
        gradeType: "G1",
        gradeLabel: "Grade 1",
        base: 4,
        cells: {
          INDEPENDENT: { count: 0, base: 4, pct: 0 },
          NOT_COLLECTED: { count: 4, base: 4, pct: 100 },
        },
      }),
      group({
        key: "overall|G3",
        label: "All schools",
        gradeType: "G3",
        gradeLabel: "Grade 3",
        base: 5,
        cells: {
          INDEPENDENT: { count: 2, base: 5, pct: 40 },
        },
      }),
      group({
        key: "overall",
        label: "All schools",
        gradeType: null,
        gradeLabel: "All grades",
        base: 9,
        cells: {
          INDEPENDENT: { count: 2, base: 9, pct: 22.2 },
          NOT_COLLECTED: { count: 4, base: 9, pct: 44.4 },
        },
      }),
    ],
  },
};

describe("SummaryTable", () => {
  it("renders counts with one-decimal percentages", () => {
    render(<SummaryTable section={genderSection} />);
    const row = screen.getByRole("row", { name: /All schools/ });
    expect(within(row).getByText("12.5%")).toBeTruthy();
    expect(within(row).getByText("87.5%")).toBeTruthy();
    expect(within(row).getByText("7")).toBeTruthy();
  });

  it("shows a null percentage as a dash and zero-fills the count", () => {
    render(<SummaryTable section={genderSection} />);
    const row = screen.getByRole("row", { name: /Empty Elementary/ });
    expect(within(row).getAllByText("—")).toHaveLength(2);
    expect(within(row).getAllByText("0").length).toBeGreaterThanOrEqual(2);
  });

  it("zero-fills a bucket the group never saw", () => {
    render(<SummaryTable section={profileSection} />);
    const g3 = screen.getByRole("row", { name: /Grade 3/ });
    // NOT_COLLECTED is absent from the Grade 3 cells; cellOf fills it with 0 of 5.
    expect(within(g3).getByText("0.0%")).toBeTruthy();
  });

  it("lists the total first, then one sub-row per grade", () => {
    render(<SummaryTable section={profileSection} />);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("All grades");
    expect(rows[1]!.textContent).toContain("Grade 1");
    expect(rows[2]!.textContent).toContain("Grade 3");
  });

  it("marks a grade whose whole population is outside the question as not collected", () => {
    render(<SummaryTable section={profileSection} />);
    const g1 = screen.getByRole("row", { name: /Grade 1/ });
    expect(within(g1).getByText("Not collected for this grade")).toBeTruthy();
    expect(within(g1).queryByText("100.0%")).toBeNull();
  });

  it("drops an all-zero Not collected column", () => {
    render(<SummaryTable section={genderSection} />);
    expect(screen.queryByRole("columnheader", { name: /Not collected/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Total" })).toBeTruthy();
  });
});
