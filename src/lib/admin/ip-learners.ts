import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { adminDashboard, schoolsList } from "@/lib/cache/tags";
import { adminPopulationScope } from "@/lib/dashboard/aggregates";
import { isDemoVisible } from "@/lib/demo/session";
import { ACTIVE_ENROLLED_LEARNER } from "@/lib/learners/population";
import { IP_ETHNICITIES } from "@/lib/ip/ethnicity";
import { shapeIpOverview, type IpOverview } from "@/lib/ip/overview";
import { ACCOUNT_GRADE_VALUES, cleanFilterId, cleanFilterText } from "@/lib/admin/accounts";

/**
 * Super Admin: every IP figure for Management → IP Learners. Cross-tenant by
 * design; the caller has already run `requireUser("SUPER_ADMIN")`.
 *
 * Three `groupBy`/`findMany` calls plus one small grade lookup; no learner
 * rows are loaded. Demo tenant scoped like the dashboard. Cached under the
 * tags learner create/archive/import and school changes already bust.
 */
export type IpOverviewFilter = { district?: string; schoolId?: string };

const IP_LEARNER: Prisma.LearnerWhereInput = {
  OR: [
    { ethnicity: { in: [...IP_ETHNICITIES] } },
    { secondaryEthnicity: { in: [...IP_ETHNICITIES] } },
  ],
};

export async function getIpLearnersOverview(filter: IpOverviewFilter = {}): Promise<IpOverview> {
  const demoVisible = await isDemoVisible();
  const f = {
    district: cleanFilterText(filter.district),
    schoolId: cleanFilterId(filter.schoolId),
  };
  return cachedQuery(
    async () => {
      const { schoolScope, viaSchool } = adminPopulationScope(demoVisible);
      const schoolWhere: Prisma.SchoolWhereInput = {
        deletedAt: null,
        ...schoolScope,
        ...(f.district ? { district: f.district } : {}),
        ...(f.schoolId ? { id: f.schoolId } : {}),
      };
      // The dashboard's enrolled population, narrowed to the filter.
      const enrolled: Prisma.LearnerWhereInput = {
        AND: [
          ACTIVE_ENROLLED_LEARNER,
          { archivedAt: null },
          viaSchool,
          ...(f.district ? [{ school: { district: f.district } }] : []),
          ...(f.schoolId ? [{ schoolId: f.schoolId }] : []),
        ],
      };

      const [schools, enrolledBySchool, ipRows] = await Promise.all([
        prisma.school.findMany({
          where: schoolWhere,
          select: { id: true, name: true, district: true },
        }),
        prisma.learner.groupBy({ by: ["schoolId"], where: enrolled, _count: { _all: true } }),
        prisma.learner.groupBy({
          by: ["schoolId", "gradeLevelId", "gender", "isAralLearner", "ethnicity", "secondaryEthnicity"],
          where: { AND: [enrolled, IP_LEARNER] },
          _count: { _all: true },
        }),
      ]);

      const gradeIds = [...new Set(ipRows.map((r) => r.gradeLevelId))];
      const grades = gradeIds.length
        ? await prisma.gradeLevel.findMany({
            where: { id: { in: gradeIds } },
            select: { id: true, type: true },
          })
        : [];

      return shapeIpOverview({
        schools,
        enrolledBySchool,
        ipRows,
        gradeTypeById: new Map(grades.map((g) => [g.id, g.type])),
        gradeOrder: ACCOUNT_GRADE_VALUES,
      });
    },
    {
      keyParts: ["admin-ip-overview-v1", `demo:${demoVisible}`, JSON.stringify(f)],
      tags: [adminDashboard, schoolsList],
      profile: "aggregate",
    }
  );
}
