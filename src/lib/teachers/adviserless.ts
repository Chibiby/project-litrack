import "server-only";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { schoolDashboard } from "@/lib/cache/tags";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

export type AdviserlessSection = {
  id: string;
  gradeLabel: string;
  sectionName: string;
  learnerCount: number;
};

/**
 * Sections that currently have live learners but no adviser — the state a
 * teacher's designation or advisory-mode change can create when it releases a
 * section (e.g. dropping to `FLOATING`, or a cap reduction).
 *
 * Tenant-scoped by `schoolId` in the `where`. Soft-delete safe: the section
 * itself must be live (`deletedAt: null`), and `learners: { some: { deletedAt:
 * null } }` means a section whose only learners are archived is not reported —
 * it has no live learners to lose an adviser over.
 *
 * Cached under the `schoolDashboard(schoolId)` tag, which every advisory
 * mutation already busts through `revalidateSchoolDashboard`.
 */
export async function getAdviserlessSections(
  schoolId: string
): Promise<AdviserlessSection[]> {
  return cachedQuery(
    async () => {
      const rows = await prisma.section.findMany({
        where: {
          schoolId,
          deletedAt: null,
          adviserId: null,
          learners: { some: { deletedAt: null } },
        },
        select: {
          id: true,
          name: true,
          gradeLevel: { select: { type: true } },
          _count: { select: { learners: { where: { deletedAt: null } } } },
        },
        orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }],
      });
      return rows.map((s) => ({
        id: s.id,
        gradeLabel: GRADE_LEVEL_LABELS[s.gradeLevel.type] ?? s.gradeLevel.type,
        sectionName: s.name,
        learnerCount: s._count.learners,
      }));
    },
    {
      keyParts: ["adviserless-sections-v1", schoolId],
      tags: [schoolDashboard(schoolId)],
      profile: "aggregate",
    }
  );
}
