import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { divisionSummary, schoolsList } from "@/lib/cache/tags";
import { demoSchoolFilter } from "@/lib/settings/system-settings";
import {
  schoolWhereForScope,
  scopeCacheKey,
  type AdminScope,
  type SummaryScope,
} from "@/lib/auth/admin-scope";
import type { ScopeSchool } from "@/lib/summary/types";

/**
 * Where scoped schools come from, once (docs/specs/district-admin.md 3.5).
 *
 * Every district page, picker and summary query takes its school list from
 * here; the summary SQL is then scoped by `"schoolId" = ANY(<these ids>)`.
 *
 * Demo exclusion (invariant I10): a district scope always carries
 * `isDemo: false` through `schoolWhereForScope`; the division follows
 * `demoSchoolFilter(demoVisible)`, exactly as `getAdminMetricCounts` does.
 *
 * A `school` scope must already have passed `loadSchoolInScope`; this only
 * re-applies the live/demo filter to it.
 */
export function scopeSchoolWhere(
  scope: AdminScope | SummaryScope,
  demoVisible: boolean
): Prisma.SchoolWhereInput {
  switch (scope.kind) {
    case "division":
    case "all":
      return { ...schoolWhereForScope({ kind: "division" }), ...demoSchoolFilter(demoVisible) };
    case "districts":
      return schoolWhereForScope({ kind: "districts", districts: scope.districts });
    case "school":
      return {
        AND: [
          { id: scope.schoolId },
          { ...schoolWhereForScope({ kind: "division" }), ...demoSchoolFilter(demoVisible) },
        ],
      };
  }
}

/**
 * The schools a scope covers, name order. Cached under `schoolsList` and
 * `divisionSummary` (a school created, archived, re-districted or flagged demo
 * busts both), keyed by `scopeCacheKey`.
 */
export async function resolveScopeSchools(
  scope: AdminScope | SummaryScope,
  demoVisible: boolean
): Promise<ScopeSchool[]> {
  return cachedQuery(
    () =>
      prisma.school.findMany({
        where: scopeSchoolWhere(scope, demoVisible),
        select: {
          id: true,
          name: true,
          schoolIdCode: true,
          district: true,
          division: true,
          region: true,
          isActive: true,
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    {
      keyParts: ["summary-scope-schools", "v1", scopeCacheKey(scope, demoVisible)],
      tags: [schoolsList, divisionSummary],
      profile: "reference",
    }
  );
}
