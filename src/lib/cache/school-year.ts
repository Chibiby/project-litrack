import "server-only";
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
};

/**
 * The school's one active school year.
 *
 * At most one row per school by design, so the key is `schoolId` alone and the
 * result is tiny. Tagged `schoolDashboard(schoolId)`: `createSchoolYear` and
 * `activateSchoolYear` are the only writers of `isActive`, `label` and
 * `startDate`, and both call `revalidateSchoolDashboard`. `null` is cached like
 * any other result and cleared by the same tag when a year is activated.
 *
 * The string conversion happens *inside* the cached function, with
 * `formatLocalDateKey` and never `toISOString()`. This is exactly equivalent to
 * passing the raw `Date` on to `getTermWindows`: that function's first act is
 * `formatLocalDateKey(arg).slice(0, 7)` (`src/lib/terms/windows.ts:72-76`), and
 * `formatLocalDateKey(parseLocalDateKey(k)) === k` for any `YYYY-MM-DD`
 * (`src/lib/date-keys.ts:2-18`), so the term anchor is unchanged.
 */
export async function getActiveSchoolYear(
  schoolId: string
): Promise<ActiveSchoolYear | null> {
  return cachedQuery(
    async () => {
      const schoolYear = await prisma.schoolYear.findFirst({
        where: { schoolId, isActive: true },
        select: { id: true, label: true, startDate: true },
      });
      if (!schoolYear) return null;

      return {
        id: schoolYear.id,
        label: schoolYear.label,
        startDateKey: formatLocalDateKey(schoolYear.startDate),
      };
    },
    {
      keyParts: ["active-school-year-v1", schoolId],
      tags: [schoolDashboard(schoolId)],
      profile: "volatile",
    }
  );
}
