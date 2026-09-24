/**
 * Which schools an administrator may see and change: the pure half.
 *
 * No Prisma client, no session, no `server-only` — this module only decides.
 * `@/lib/auth/district-scope` fetches the facts (the signed-in user, their
 * district assignments, a school row) and hands them here.
 *
 * The rule it encodes (docs/specs/district-admin.md 3.4):
 * - A SUPER_ADMIN sees the whole division.
 * - A DISTRICT_ADMIN sees the non-demo, live schools whose `School.district`
 *   exactly equals one of their assigned districts. No assignments, no schools.
 * - Every other role has no admin scope at all.
 *
 * An out-of-scope school is reported with the same NOT_FOUND a missing row
 * gets, so a district admin cannot learn that a school exists elsewhere. Only
 * the admin error record (severity `security`) tells the two apart.
 */
import type { Prisma, UserRole } from "@prisma/client";
import { resourceNotFound } from "@/lib/errors/app-error";

export type AdminScope =
  /** SUPER_ADMIN only. */
  | { kind: "division" }
  /** DISTRICT_ADMIN: sorted, deduplicated. Empty means the admin sees nothing. */
  | { kind: "districts"; districts: readonly string[] };

/**
 * What one page or export looks at, already narrowed to the caller's
 * `AdminScope` by `resolveSummaryScope`.
 *
 * `all` is only ever produced for the division scope. A district admin's
 * "everything I may see" comes back as `districts` naming their districts, so a
 * `SummaryScope` alone always says which schools it covers — two admins with
 * different assignments can never share a cache key through an `all`.
 */
export type SummaryScope =
  | { kind: "all" }
  | { kind: "districts"; districts: readonly string[] }
  | { kind: "school"; schoolId: string };

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** The one place a role becomes a scope. `null` means "no admin scope": refuse. */
export function adminScopeFor(role: UserRole, assignedDistricts: string[]): AdminScope | null {
  switch (role) {
    case "SUPER_ADMIN":
      return { kind: "division" };
    case "DISTRICT_ADMIN":
      return { kind: "districts", districts: sortedUnique(assignedDistricts) };
    default:
      // Assignment rows on any other role grant nothing (spec I1).
      return null;
  }
}

/**
 * Prisma `School` filter for a scope — the only function that turns a scope
 * into a WHERE.
 *
 * The division scope does not filter demo schools here; callers that list
 * schools add `demoSchoolFilter(await isDemoVisible())` themselves, as the
 * admin dashboard does. A district scope always excludes them. Prisma's
 * `in: []` matches no rows, so an admin with no assignments sees nothing.
 */
export function schoolWhereForScope(scope: AdminScope): Prisma.SchoolWhereInput {
  switch (scope.kind) {
    case "division":
      return { deletedAt: null };
    case "districts":
      return { deletedAt: null, isDemo: false, district: { in: [...scope.districts] } };
  }
}

/**
 * For a school row that reached the caller some other way (a ticket, an unlock
 * recipient). Prefer `loadSchoolInScope`, which puts the scope in the WHERE.
 *
 * Throws the same NOT_FOUND a missing school gets. Out-of-scope rows are marked
 * `crossTenant`, which records them with severity `security`.
 */
export function assertSchoolInScope(
  scope: AdminScope,
  school: { district: string | null; isDemo: boolean } | null
): void {
  if (!school) throw resourceNotFound("School");
  if (scope.kind === "division") return;

  if (school.isDemo) {
    throw resourceNotFound("School", {
      crossTenant: true,
      detail: `Demo school requested by a district admin scoped to ${describeDistricts(scope.districts)}`,
    });
  }
  if (school.district === null || !scope.districts.includes(school.district)) {
    throw resourceNotFound("School", {
      crossTenant: true,
      detail: `School in district ${JSON.stringify(school.district)} is outside ${describeDistricts(scope.districts)}`,
    });
  }
}

/**
 * Narrow a requested view (from search params or an export payload) to what
 * the caller may see.
 *
 * - A district outside a district admin's assignments is NOT_FOUND.
 * - A requested `schoolId` comes back as `{ kind: "school" }` unchecked: it
 *   MUST then pass `loadSchoolInScope` before anything is read for it.
 * - Nothing requested: the whole scope (`all` for the division, the admin's own
 *   districts otherwise — see `SummaryScope`).
 *
 * Empty strings count as "not requested", matching how `?district=` arrives.
 */
export function resolveSummaryScope(
  scope: AdminScope,
  requested: { district?: string; schoolId?: string }
): SummaryScope {
  const district = requested.district || undefined;
  const schoolId = requested.schoolId || undefined;

  // Checked even when a school is also named, so an out-of-scope district in a
  // request is always refused rather than silently ignored.
  if (district !== undefined && scope.kind === "districts" && !scope.districts.includes(district)) {
    throw resourceNotFound("District", {
      crossTenant: true,
      detail: `District ${JSON.stringify(district)} is outside ${describeDistricts(scope.districts)}`,
    });
  }

  if (schoolId !== undefined) return { kind: "school", schoolId };
  if (district !== undefined) return { kind: "districts", districts: [district] };
  return scope.kind === "division"
    ? { kind: "all" }
    : { kind: "districts", districts: scope.districts };
}

/**
 * Cache key fragment for a scoped read. Same scope, same key, whatever order
 * the districts came in; different scopes never share one.
 *
 * `all` keys exactly like `division`, because `resolveSummaryScope` only ever
 * produces `all` for the division. District names are JSON-encoded, so a name
 * containing the separator cannot make two different sets collide.
 */
export function scopeCacheKey(scope: AdminScope | SummaryScope, demoVisible: boolean): string {
  const demo = `demo=${demoVisible ? 1 : 0}`;
  switch (scope.kind) {
    case "division":
    case "all":
      return `division|${demo}`;
    case "districts":
      return `districts:${JSON.stringify(sortedUnique(scope.districts))}|${demo}`;
    case "school":
      return `school:${JSON.stringify(scope.schoolId)}|${demo}`;
  }
}

function describeDistricts(districts: readonly string[]): string {
  return districts.length === 0 ? "no assigned districts" : `districts ${JSON.stringify(districts)}`;
}
