import "server-only";
import type { TermWindowOverrideInput } from "@/lib/terms/windows";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolDashboard } from "@/lib/cache/tags";
import { formatLocalDateKey } from "@/lib/date-keys";

export type ActiveSchoolYear = {
  id: string;
  label: string;
  /**
   * `SchoolYear.startDate` as a `YYYY-MM-DD` string, not a `Date`.
   *
   * `unstable_cache` serialises to JSON, so a `Date` field would arrive back from
   * the cache as a string while Prisma still types it `Date` — `tsc` passes and
   * the first method call on it throws at runtime. Same rule, and same reason, as
   * `TeacherOverview.todayKey`. Parse it at the point of use with
   * `parseLocalDateKey`.
   */
  startDateKey: string;
  /** `SchoolYear.endDate` as a key, for the same JSON reason as `startDateKey`. */
  endDateKey: string;
  /**
   * The head's edits to this year's term windows, empty for most schools.
   *
   * Already plain strings in the database, which is why they survive
   * `unstable_cache`'s JSON round trip untouched — the hazard `startDateKey`
   * exists to avoid does not arise here at all.
   */
  overrides: TermWindowOverrideInput[];
};

/**
 * The school's one active school year, including its term window overrides.
 *
 * At most one row per school by design, so the key is `schoolId` alone and the
 * result is tiny. Tagged `schoolDashboard(schoolId)`: `createSchoolYear` and
 * `setActiveSchoolYear` are the only two actions that write `SchoolYear` at all
 * (`src/lib/actions/school-year.ts` holds the only four writes in `src`), and both
 * call `revalidateSchoolDashboard`. `null` is cached like any other result and
 * cleared by the same tag when a year is activated.
 *
 * The string conversion happens *inside* the cached function, with
 * `formatLocalDateKey` and never `toISOString()`. This is exactly equivalent to
 * passing the raw `Date` on to `getTermWindows`: that function's first act is
 * `formatLocalDateKey(arg).slice(0, 7)` (`src/lib/terms/windows.ts:97-100`), and
 * `formatLocalDateKey(parseLocalDateKey(k)) === k` for any `YYYY-MM-DD`
 * (`src/lib/date-keys.ts:2-18`), so the term anchor is unchanged.
 *
 * The overrides are already strings in the database (`startKey`, `endKey`,
 * `deadlineKey` are all stored as `YYYY-MM-DD`), so they survive the JSON
 * round-trip untouched.
 */
export async function getActiveSchoolYear(
  schoolId: string
): Promise<ActiveSchoolYear | null> {
  return cachedQuery(
    async () => {
      const schoolYear = await prisma.schoolYear.findFirst({
        where: { schoolId, isActive: true },
        select: {
          id: true,
          label: true,
          startDate: true,
          endDate: true,
          // Selected inline rather than as a second round trip: the caller that
          // wants the year always wants its windows, and this is at most three
          // tiny rows.
          termWindowOverrides: {
            select: {
              term: true,
              startKey: true,
              endKey: true,
              deadlineKey: true,
            },
          },
        },
      });
      if (!schoolYear) return null;

      return {
        id: schoolYear.id,
        label: schoolYear.label,
        startDateKey: formatLocalDateKey(schoolYear.startDate),
        endDateKey: formatLocalDateKey(schoolYear.endDate),
        overrides: schoolYear.termWindowOverrides,
      };
    },
    {
      keyParts: ["active-school-year-v2", schoolId],
      tags: [schoolDashboard(schoolId)],
      profile: "volatile",
    }
  );
}
