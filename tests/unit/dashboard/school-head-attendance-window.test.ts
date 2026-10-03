process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 2026-10-05T17:00Z is 01:00 on 2026-10-06 in Manila. On a UTC runtime the
 * School Head 7-day trend must still end on the school's civil day (10-06),
 * and the cache key must name that same day.
 */
const NOW = new Date("2026-10-05T17:00:00Z");

const attendanceGroupBy = vi.fn(async (_args: unknown) => [
  { date: new Date("2026-10-06T00:00:00Z"), _count: { _all: 4 } },
  { date: new Date("2026-10-05T00:00:00Z"), _count: { _all: 9 } },
]);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendance: { groupBy: (a: unknown) => attendanceGroupBy(a) },
    learner: { groupBy: async () => [] },
    readingLevelRecord: { groupBy: async () => [] },
  },
}));

const keyPartsSeen: string[][] = [];
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown, keyParts: string[]) => {
    keyPartsSeen.push(keyParts);
    return fn;
  },
}));

const { getSchoolHeadCharts } = await import("@/lib/dashboard/aggregates");

beforeEach(() => {
  vi.clearAllMocks();
  keyPartsSeen.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getSchoolHeadCharts — attendance window", () => {
  it("ends on the school's civil day, not the UTC day", async () => {
    const charts = await getSchoolHeadCharts("school-1");

    expect(charts.attendanceTrend).toHaveLength(7);
    expect(charts.attendanceTrend.map((d) => d.date)).toEqual([
      "09-30",
      "10-01",
      "10-02",
      "10-03",
      "10-04",
      "10-05",
      "10-06",
    ]);
    expect(charts.attendanceTrend.at(-1)).toEqual({ date: "10-06", value: 4 });
    expect(charts.attendanceTrend.at(-2)).toEqual({ date: "10-05", value: 9 });
    expect(keyPartsSeen.flat()).toContain("2026-10-06");
  });
});
