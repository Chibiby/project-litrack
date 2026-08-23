import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";

/**
 * `getActiveSchoolYear`'s one contract that typecheck cannot hold: `startDateKey`
 * is a `YYYY-MM-DD` string, not a `Date`.
 *
 * `unstable_cache` serialises to JSON. Put a `Date` in a cached value and Prisma
 * still types the field `Date`, `tsc` still passes, and the *second* read — the one
 * that comes back out of the cache — hands the consumer a string. The module
 * therefore converts inside the cached function (`src/lib/cache/school-year.ts:53`),
 * and this file is what fails if that conversion is moved out or dropped.
 *
 * The consumer makes the failure quiet rather than loud, which is why a test is
 * worth more here than usual: the only reader is
 * `src/app/teacher/(app)/aral/[gradeId]/terms-reports/page.tsx`, which does
 * `getTermWindows(parseLocalDateKey(schoolYear.startDateKey))`, and
 * `parseLocalDateKey` falls back to **today** for anything that is not
 * `YYYY-MM-DD` (`src/lib/date-keys.ts:10-18`). So a raw `Date` reaching the cache
 * would not throw — it would serialise to an ISO timestamp, miss the regex, and
 * silently anchor every term window to the day the page was opened.
 */

const SCHOOL_ID = "school-malandag";

/**
 * Built with the local `Date` constructor and asserted with local calendar
 * getters, so the expectation holds in any `TZ` — no pin needed. `Date.UTC` here
 * would make the expected key timezone-dependent, which is the bug class this
 * module exists to avoid rather than one to reproduce in its test.
 */
const START_DATE = new Date(2026, 5, 1);
const START_KEY = "2026-06-01";

type FindFirstArgs = {
  where: { schoolId: string; isActive: boolean };
  select: Record<string, boolean>;
};

let row: { id: string; label: string; startDate: Date } | null = null;

const schoolYearFindFirst = vi.fn(async (_args: FindFirstArgs) => row);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    schoolYear: {
      findFirst: (...a: unknown[]) =>
        schoolYearFindFirst(...(a as [FindFirstArgs])),
    },
  },
}));

// `cachedQuery` calls `unstable_cache(fn, keyParts, opts)()`. Returning `fn`
// unwrapped runs the read every time while still evaluating `keyParts`, so a
// throwing key part would surface here.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

const { getActiveSchoolYear } = await import("@/lib/cache/school-year");

beforeEach(() => {
  vi.clearAllMocks();
  row = { id: "sy-1", label: "2026-2027", startDate: START_DATE };
});

describe("getActiveSchoolYear", () => {
  it("returns startDate as a YYYY-MM-DD key that round-trips through parseLocalDateKey", async () => {
    const active = await getActiveSchoolYear(SCHOOL_ID);

    // Anti-vacuity, and the tenant scope in one: prove the read really ran and
    // ran scoped, so the assertions below are about a converted value and not
    // about some default the mock would have returned anyway.
    expect(schoolYearFindFirst).toHaveBeenCalledTimes(1);
    expect(schoolYearFindFirst.mock.calls[0][0].where).toEqual({
      schoolId: SCHOOL_ID,
      isActive: true,
    });

    expect(active?.startDateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(active?.startDateKey).toBe(START_KEY);

    // The property the consumer depends on: the key parses back to the same
    // civil day. An ISO timestamp would fail the regex above and land on today
    // here, so both halves are asserted.
    const parsed = parseLocalDateKey(active?.startDateKey);
    expect([parsed.getFullYear(), parsed.getMonth(), parsed.getDate()]).toEqual([
      2026, 5, 1,
    ]);
    expect(formatLocalDateKey(parsed)).toBe(START_KEY);
  });

  it("lets no Date cross the cache boundary", async () => {
    const active = await getActiveSchoolYear(SCHOOL_ID);

    // Catches the regression directly: adding `startDate` back to the returned
    // object, or converting at the call site instead of inside the cached
    // function, puts a `Date` in a value that JSON will flatten to a string.
    expect(active).not.toHaveProperty("startDate");
    for (const value of Object.values(active ?? {})) {
      expect(value).not.toBeInstanceOf(Date);
    }
  });

  it("returns null for a school with no active year", async () => {
    row = null;

    // `null` is a cached result like any other, cleared by the same
    // `schoolDashboard` tag when a year is activated. Asserted because the guard
    // that produces it also protects the conversion above from a null row.
    await expect(getActiveSchoolYear(SCHOOL_ID)).resolves.toBeNull();
  });
});
