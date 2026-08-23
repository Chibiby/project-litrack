// UTC before the first Date. Two reasons, both load-bearing:
//   1. It is the runtime `src/lib/date-keys.ts` documents for production ("Vercel
//      lambdas run with TZ=UTC"), so this exercises the window the code really
//      computes rather than a UTC+8 dev-box variant.
//   2. `getSchoolHeadCharts` labels `readingTrend` with `toISOString().slice(0, 10)`
//      while flooring the query with `daysAgo()`, which reads LOCAL calendar
//      fields. Only where local == UTC do the label and the floor name the same
//      civil day, so any other zone would make the expected labels below a
//      statement about the test's timezone instead of about the bound.
process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDateKey } from "@/lib/date-keys";

/**
 * The one behaviour `getSchoolHeadCharts`'s reading-level `groupBy` bound trades
 * on. That query used to have no `weekStart` floor: it grouped every record the
 * school had ever written, sorted ascending, and JavaScript then threw all but
 * the newest 6 groups away via `slice(-6)`.
 *
 * The bound is 12 weeks (`daysAgo(84)`), and the reason it is 12 rather than 6 is
 * exactly what is asserted here: `slice(-6)` takes the 6 most recent RECORDED
 * weeks, not the last 6 calendar weeks, so a school that skips weeks reaches
 * further back than 6 weeks to fill its 6 points. A 6-week floor would silently
 * render fewer points for those schools; a 12-week floor does not.
 *
 * Scope: the pre-existing `learner: { schoolId, deletedAt: null }` tenant scope on
 * this query is untouched by the bound and is not what this test probes.
 */

const SCHOOL_ID = "school-malandag";

/** Wed 19 Aug 2026. Monday of that week is the 17th; `daysAgo(84)` is 27 May 2026. */
const TODAY = new Date(Date.UTC(2026, 7, 19, 9, 0, 0));
const FLOOR_KEY = "2026-05-27";

function monday(year: number, month1: number, day: number) {
  return new Date(Date.UTC(year, month1 - 1, day));
}

/**
 * A sparse school: six recorded weeks, every OTHER week, spanning ten weeks back.
 * Six points that reach further back than six calendar weeks — the shape the
 * 12-week bound exists to preserve.
 */
const RECORDED_WEEKS = [
  { weekStart: monday(2026, 8, 17), count: 6 },
  { weekStart: monday(2026, 8, 3), count: 5 },
  { weekStart: monday(2026, 7, 20), count: 4 },
  { weekStart: monday(2026, 7, 6), count: 3 },
  { weekStart: monday(2026, 6, 22), count: 2 },
  { weekStart: monday(2026, 6, 8), count: 1 },
  // Mon 25 May 2026 — two days BEFORE the 84-day floor, so the bound is the only
  // thing that can exclude it. Distinctive count so a leak is unmistakable.
  { weekStart: monday(2026, 5, 25), count: 99 },
];

/**
 * Applies the floor the action actually passed, rather than a floor this test
 * assumes. With no `where.weekStart` — i.e. the unbounded query this task
 * removed — every row comes back, which is what makes the assertions live.
 */
const readingLevelGroupBy = vi.fn(
  async (args: { where: { weekStart?: { gte?: Date } } }) => {
    const floor = args.where.weekStart?.gte;
    return RECORDED_WEEKS.filter(
      (w) => floor === undefined || w.weekStart.getTime() >= floor.getTime()
    )
      .sort((a, b) => a.weekStart.getTime() - b.weekStart.getTime())
      .map((w) => ({ weekStart: w.weekStart, _count: { _all: w.count } }));
  }
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    attendance: { groupBy: async () => [] },
    learner: { groupBy: async () => [] },
    readingLevelRecord: {
      groupBy: (...a: unknown[]) => readingLevelGroupBy(...(a as [never])),
    },
  },
}));

// `cachedQuery` calls `unstable_cache(fn, keyParts, opts)()`. Returning `fn`
// unwrapped runs the read every time while still evaluating `keyParts`, so a
// throwing key part would surface here.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

const { getSchoolHeadCharts } = await import("@/lib/dashboard/aggregates");

beforeEach(() => {
  vi.clearAllMocks();
  // Only Date: the aggregate awaits promises, and faking the microtask queue
  // would hang them.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getSchoolHeadCharts — the reading-level groupBy bound", () => {
  it("keeps all 6 trend points for a school with gaps, and drops weeks older than 12", async () => {
    const charts = await getSchoolHeadCharts(SCHOOL_ID);

    // (a) Six recorded weeks inside the 12-week window still render six points,
    // in ascending order, even though they span ten calendar weeks. A 6-week
    // floor would leave only the three from 6 Jul onward.
    expect(charts.readingTrend).toEqual([
      { name: "2026-06-08", value: 1 },
      { name: "2026-06-22", value: 2 },
      { name: "2026-07-06", value: 3 },
      { name: "2026-07-20", value: 4 },
      { name: "2026-08-03", value: 5 },
      { name: "2026-08-17", value: 6 },
    ]);

    // (b) The record older than the bound never reaches the query, let alone the
    // chart. Asserted on the floor the action passed, because `slice(-6)` would
    // have hidden that row anyway — the trend alone cannot tell a bounded query
    // from an unbounded one.
    const floor = readingLevelGroupBy.mock.calls[0][0].where.weekStart?.gte;
    expect(floor && formatLocalDateKey(floor)).toBe(FLOOR_KEY);
    expect(charts.readingTrend.map((p) => p.value)).not.toContain(99);
  });
});
