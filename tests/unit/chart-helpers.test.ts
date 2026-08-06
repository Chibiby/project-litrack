import { describe, expect, it } from "vitest";
import {
  distributionFromCounts,
  emptyActivitySeries,
  isChartSeriesEmpty,
  sumNamedCounts,
} from "@/lib/dashboard/chart-helpers";

describe("chart helpers (empty input)", () => {
  it("builds empty activity series of zeros", () => {
    const series = emptyActivitySeries(["08-01", "08-02"]);
    expect(series).toEqual([
      { date: "08-01", value: 0 },
      { date: "08-02", value: 0 },
    ]);
    expect(isChartSeriesEmpty(series)).toBe(true);
  });

  it("treats empty array as empty chart", () => {
    expect(isChartSeriesEmpty([])).toBe(true);
    expect(isChartSeriesEmpty([{ value: 1 }])).toBe(false);
  });

  it("fills missing distribution keys with zero", () => {
    const counts = new Map([["A", 3]]);
    const dist = distributionFromCounts(["A", "B"], counts, (k) => `Label ${k}`);
    expect(dist).toEqual([
      { name: "Label A", value: 3 },
      { name: "Label B", value: 0 },
    ]);
    expect(sumNamedCounts(dist)).toBe(3);
    expect(sumNamedCounts([])).toBe(0);
  });
});
