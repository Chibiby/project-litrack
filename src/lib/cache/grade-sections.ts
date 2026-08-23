import "server-only";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolDashboard } from "@/lib/cache/tags";

export type GradeSectionOption = { id: string; name: string };

/**
 * A school's live sections for one or more grade levels, by name.
 *
 * The same read, byte for byte, on five roster surfaces: the ARAL dashboard, the
 * advisory roster, the weekly attendance sheet, the monthly reading-level sheet,
 * and the terms sheet's Super Admin branch. Each of them uses it for the same two
 * jobs — the section filter's options and "does this grade use sections at all",
 * which decides whether the Section column earns its width.
 *
 * Keyed on `schoolId` plus the sorted grade ids, and that is the complete
 * discriminator: the `where` below carries no teacher predicate, so two teachers
 * with the same assigned grades legitimately share the entry and neither a
 * `teacherId` nor an `isSuperAdmin` part would narrow anything. The grade ids are
 * joined into one part rather than spread, so `["a","b"]` cannot collide with
 * `["a-b"]`, and sorted on a copy so two callers holding the same set in a
 * different order do not mint two entries.
 *
 * `schoolDashboard(schoolId)` is the tag: `createSection`, `updateSection` and
 * `deleteSection` are the only writers of these rows and all three call
 * `revalidateSchoolDashboard`. That tag is deliberately broader than sections —
 * every learner mutation busts it too — so the practical effect of `volatile`
 * here is to collapse this read across a burst of navigation that contains no
 * write, not to hold it for a full 15 s in a school that is being edited.
 *
 * No `Date` crosses the cache boundary: `deletedAt` is a filter, not a selection.
 */
export async function getGradeSections(opts: {
  schoolId: string;
  gradeLevelIds: string[];
}): Promise<GradeSectionOption[]> {
  const gradeLevelIds = [...opts.gradeLevelIds].sort();

  return cachedQuery(
    async () =>
      prisma.section.findMany({
        where: {
          schoolId: opts.schoolId,
          deletedAt: null,
          gradeLevelId: { in: gradeLevelIds },
        },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
    {
      keyParts: ["grade-sections-v1", opts.schoolId, gradeLevelIds.join(",")],
      tags: [schoolDashboard(opts.schoolId)],
      profile: "volatile",
    }
  );
}
