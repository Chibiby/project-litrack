import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { divisionSummary, schoolsList } from "@/lib/cache/tags";
import { demoSchoolFilter } from "@/lib/settings/system-settings";
import {
  schoolWhereForScope,
  type AdminScope,
  type SummaryScope,
} from "@/lib/auth/admin-scope";
import type { ScopeSchool } from "@/lib/summary/types";

/**
 * Where scoped schools come from, once (docs/specs/district-admin.md 3.5).
 *
 * Every district page, picker and summary facet takes its school list from
 * here; the summary's raw rows are then fenced to these ids by `scopeRaw`.
 *
 * Demo exclusion (invariant I10): a district scope always carries
 * `isDemo: false` through `schoolWhereForScope`; the division follows
 * `demoSchoolFilter(demoVisible)`, exactly as `getAdminMetricCounts` does.
 *
 * A `school` scope must already have passed `loadSchoolInScope` (or the
 * in-memory `findSchoolInAdminScope` hit in `resolvePageSummaryScope`); this
 * only re-applies the live/demo filter to it.
 *
 * `scopeSchoolWhere` is the WHERE form of the rule; `schoolsForScope` is the
 * same rule applied in memory to the one cached division list, and the unit
 * tests hold the two equal.
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

/** A live school with its demo flag: the one list every scope is cut from. */
export type DivisionSchool = ScopeSchool & { isDemo: boolean };

/**
 * Every live school (`deletedAt: null`, demo and inactive included), name
 * order. ONE cache entry for the whole division, under `schoolsList` and
 * `divisionSummary` (a school created, archived, re-districted or flagged demo
 * busts both). It is never handed out as it is: callers get a scope's slice
 * through `schoolsForScope` / `schoolsForAdminScope`.
 *
 * `/district`'s overview reads it directly and again inside each of the four
 * summary-facet loads; the per-request memo below collapses those into one
 * `unstable_cache`/KV lookup. React `cache()` only dedupes a zero-arg call
 * here, so scope object identity does not matter.
 */
const getRequestMemo = cache(() => ({ division: null as Promise<DivisionSchool[]> | null }));

export function loadDivisionSchools(): Promise<DivisionSchool[]> {
  const memo = getRequestMemo();
  memo.division ??= cachedQuery(
    () =>
      prisma.school.findMany({
        where: schoolWhereForScope({ kind: "division" }),
        select: {
          id: true,
          name: true,
          schoolIdCode: true,
          district: true,
          division: true,
          region: true,
          isActive: true,
          isDemo: true,
        },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    {
      keyParts: ["summary-scope-schools", "v2", "division-live"],
      tags: [schoolsList, divisionSummary],
      profile: "reference",
    }
  );
  return memo.division;
}

function toScopeSchool(s: DivisionSchool): ScopeSchool {
  return {
    id: s.id,
    name: s.name,
    schoolIdCode: s.schoolIdCode,
    district: s.district,
    division: s.division,
    region: s.region,
    isActive: s.isActive,
  };
}

/** `district: { in: [...] }`: a school with no district is in no district scope. */
function inDistricts(s: DivisionSchool, districts: readonly string[]): boolean {
  return s.district !== null && districts.includes(s.district);
}

/**
 * `scopeSchoolWhere(scope, demoVisible)` applied in memory to the live
 * division list. Order is kept (name, then id).
 */
export function schoolsForScope(
  all: readonly DivisionSchool[],
  scope: AdminScope | SummaryScope,
  demoVisible: boolean
): ScopeSchool[] {
  const demoOk = (s: DivisionSchool) => demoVisible || s.isDemo !== true;
  let kept: DivisionSchool[];
  switch (scope.kind) {
    case "division":
    case "all":
      kept = all.filter(demoOk);
      break;
    case "districts":
      // A district scope never includes a demo school, demo session or not.
      kept = all.filter((s) => s.isDemo !== true && inDistricts(s, scope.districts));
      break;
    case "school":
      kept = all.filter((s) => s.id === scope.schoolId && demoOk(s));
      break;
  }
  return kept.map(toScopeSchool);
}

/**
 * `schoolWhereForScope(adminScope)` applied in memory: the schools an admin
 * may open, which is what `loadSchoolInScope` checks. The division does NOT
 * filter demo schools here, matching `loadSchoolInScope`.
 */
export function schoolsForAdminScope(
  all: readonly DivisionSchool[],
  adminScope: AdminScope
): DivisionSchool[] {
  return adminScope.kind === "division"
    ? [...all]
    : all.filter((s) => s.isDemo !== true && inDistricts(s, adminScope.districts));
}

/**
 * A requested school, if it is inside `adminScope` according to the cached
 * division list; null on a miss. A miss proves nothing (the list may predate
 * a new school), so the caller falls back to `loadSchoolInScope`, which reads
 * the database and records an out-of-scope request as `crossTenant`.
 */
export async function findSchoolInAdminScope(
  adminScope: AdminScope,
  schoolId: string
): Promise<DivisionSchool | null> {
  const all = await loadDivisionSchools();
  return schoolsForAdminScope(all, adminScope).find((s) => s.id === schoolId) ?? null;
}

/** The schools a scope covers, name order, cut from the one cached division list. */
export async function resolveScopeSchools(
  scope: AdminScope | SummaryScope,
  demoVisible: boolean
): Promise<ScopeSchool[]> {
  return schoolsForScope(await loadDivisionSchools(), scope, demoVisible);
}
