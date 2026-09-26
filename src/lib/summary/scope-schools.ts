import "server-only";
import { cache } from "react";
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
 *
 * `/district`'s overview calls this once directly and again inside each of the
 * four summary-facet loads, all with the same scope — five separate
 * `unstable_cache`/KV lookups per request without the map below. React
 * `cache()` dedupes by argument identity, and each call site rebuilds its own
 * `scope` object (the page passes an `AdminScope`, the facet loads pass the
 * `SummaryScope` `resolveSummaryScope` just returned) — two different object
 * identities that carry the same tenancy, so keying a `cache()`-wrapped
 * function on `scope` itself would miss on every call. Instead this keys a
 * single per-request `Map` on `scopeCacheKey` alone (a string, which already
 * fully determines the query, same as the `cachedQuery` key below) — the ONE
 * argument to the outer `cache()` call is the map-factory itself, so React
 * cache only ever needs to dedupe a zero-arg call.
 */
const getRequestMemo = cache(() => new Map<string, Promise<ScopeSchool[]>>());

export async function resolveScopeSchools(
  scope: AdminScope | SummaryScope,
  demoVisible: boolean
): Promise<ScopeSchool[]> {
  const key = scopeCacheKey(scope, demoVisible);
  const memo = getRequestMemo();
  const cached = memo.get(key);
  if (cached) return cached;

  const promise = cachedQuery(
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
      keyParts: ["summary-scope-schools", "v1", key],
      tags: [schoolsList, divisionSummary],
      profile: "reference",
    }
  );
  memo.set(key, promise);
  return promise;
}
