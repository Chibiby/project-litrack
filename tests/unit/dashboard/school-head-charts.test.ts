// UTC before the first Date. What the pin actually does, stated narrowly because
// an earlier version of this header overclaimed: it makes the test compute its
// civil-day arithmetic in the zone production runs in (`src/lib/date-keys.ts:20-25`
// documents `TZ=UTC` on Vercel). It is not a correctness dependency — the expected
// labels are `toISOString()` of `Date.UTC` fixtures and so are timezone-invariant,
// and the floor is month-granular, so it resolves to the same 1st-of-month in every
// realistic zone. The pin is intent, not load-bearing.
process.env.TZ = "UTC";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDateKey } from "@/lib/date-keys";

/**
 * `getSchoolHeadCharts`'s reading-level series, and the reason it is queried the
 * way it is.
 *
 * `ReadingLevelRecord.weekStart` keeps its historical name but holds one anchor
 * per assessment *period*, and the only live writer stores the **1st of the
 * month** — `bulkRecordMonthlyReadingLevel`, whose doc block says so at
 * `src/lib/actions/reading-level.ts:132-135`, via `monthStartField` at
 * `src/lib/validators/reading-level.schema.ts:50`. The retired weekly grid's
 * Monday-writing path is dead UI.
 *
 * So the chart's "6 most recent periods" is a statement about rows, not about the
 * calendar, and the query says exactly that: `orderBy: { weekStart: "desc" }` plus
 * `take: 6`. Correctness therefore does not depend on the cadence, and a future
 * writer switching to fortnights or terms cannot silently truncate the chart.
 * The date floor is left with only the scan-bounding job R7.2 asked for.
 *
 * The fixture below is therefore firsts-of-month, matching production. An earlier
 * version used biweekly Mondays — a shape no live writer produces — which let the
 * suite pass on precisely the case that regressed.
 *
 * Scope: the pre-existing `learner: { schoolId, deletedAt: null }` tenant scope on
 * this query is untouched by this task and is not what this test probes.
 */

const SCHOOL_ID = "school-malandag";

/** Wed 19 Aug 2026. `addMonths(daysAgo(0), -17)` from here is 1 Mar 2025. */
const TODAY = new Date(Date.UTC(2026, 7, 19, 9, 0, 0));
const FLOOR_KEY = "2025-03-01";

function monthAnchor(year: number, month1: number) {
  return new Date(Date.UTC(year, month1 - 1, 1));
}

/**
 * **Seven** consecutive month anchors, every one of them inside the 18-month
 * floor. That puts the `take: 6` boundary under test rather than the floor: the
 * oldest anchor (Feb 2026) must be dropped by `take`, not by the date window.
 */
const RECORDED_MONTHS = [
  { weekStart: monthAnchor(2026, 8), count: 8 },
  { weekStart: monthAnchor(2026, 7), count: 7 },
  { weekStart: monthAnchor(2026, 6), count: 6 },
  { weekStart: monthAnchor(2026, 5), count: 5 },
  { weekStart: monthAnchor(2026, 4), count: 4 },
  { weekStart: monthAnchor(2026, 3), count: 3 },
  { weekStart: monthAnchor(2026, 2), count: 2 },
];

/**
 * Models Postgres for the three things this test turns on: it applies whatever
 * floor the action passed, sorts in whatever direction the action asked for, and
 * honours `take`. So dropping `take`, inverting `orderBy`, or losing the reverse
 * in the consumer each changes the output the assertions see.
 */
const readingLevelGroupBy = vi.fn(
  async (args: {
    where: { weekStart?: { gte?: Date } };
    orderBy?: { weekStart?: "asc" | "desc" };
    take?: number;
  }) => {
    const floor = args.where.weekStart?.gte;
    const direction = args.orderBy?.weekStart === "desc" ? -1 : 1;
    const rows = RECORDED_MONTHS.filter(
      (m) => floor === undefined || m.weekStart.getTime() >= floor.getTime()
    )
      .sort((a, b) => direction * (a.weekStart.getTime() - b.weekStart.getTime()))
      .map((m) => ({ weekStart: m.weekStart, _count: { _all: m.count } }));
    return args.take === undefined ? rows : rows.slice(0, args.take);
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

describe("getSchoolHeadCharts — the reading-level series", () => {
  it("renders the 6 most recent recorded months, oldest first, and floors the scan at 18 months", async () => {
    const charts = await getSchoolHeadCharts(SCHOOL_ID);

    // (a) Six points from seven available periods, ascending. This is the
    // assertion the previous fixture could not make: with month anchors it fails
    // if `take: 6` is dropped (7 points), if `orderBy` is `asc` (the oldest six,
    // Feb-Jul), or if the consumer stops reversing (descending labels).
    expect(charts.readingTrend).toEqual([
      { name: "2026-03-01", value: 3 },
      { name: "2026-04-01", value: 4 },
      { name: "2026-05-01", value: 5 },
      { name: "2026-06-01", value: 6 },
      { name: "2026-07-01", value: 7 },
      { name: "2026-08-01", value: 8 },
    ]);

    // (b) The scan bound is still applied and is expressed in the column's real
    // unit — the 1st of the month 17 months back. Asserted on the argument the
    // query received, because with `take: 6` carrying correctness the floor no
    // longer shows up in the output at all, and would otherwise go unchecked.
    const floor = readingLevelGroupBy.mock.calls[0][0].where.weekStart?.gte;
    expect(floor && formatLocalDateKey(floor)).toBe(FLOOR_KEY);
  });
});
