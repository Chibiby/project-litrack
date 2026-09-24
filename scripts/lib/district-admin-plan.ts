/**
 * Pure planner for `scripts/create-district-admins.ts` (docs/specs/district-admin.md
 * section 7). No Prisma, no Supabase, no filesystem — every fact it needs
 * (the roster, who already exists, which districts are real) is passed in, so
 * it can be unit tested the same way `assignSchoolCredentials` is
 * (tests/unit/import/school-credentials.test.ts).
 *
 * I4/I5 (docs/specs/district-admin.md section 6): an assigned district must
 * name a real, non-demo district, and an admin must have 1-3 of them. Both are
 * script-only validation — neither is a database constraint — so this is the
 * one place they are checked. The caller (the script) is expected to exit 1
 * before writing anything when `unknownDistricts` or `badCounts` is non-empty.
 */

/**
 * One roster row. Usernames are the lower-case `first.last` login handle.
 * `email` is the synthetic address the script would create or reuse
 * (`emailFor(username)`) — carried here, not recomputed, so the planner can
 * match the same collision surface `scripts/seed-division-admins.ts:74-86`
 * checks (username OR email) without knowing the synthetic-email domain
 * itself.
 */
export type DistrictAdminRosterEntry = {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  districts: readonly string[];
};

/**
 * A user row already in the database whose `username` or `email` matches a
 * roster entry — the same collision surface `seed-division-admins.ts` checks.
 * `districts` is that user's current `DistrictAdminAssignment.district`
 * values (empty for every role but `DISTRICT_ADMIN`).
 */
export type ExistingDistrictAdminUser = {
  id: string;
  username: string | null;
  email: string;
  role: string;
  districts: readonly string[];
};

/** A district a new account should be created with. */
export type DistrictAdminCreatePlan = {
  username: string;
  firstName: string;
  lastName: string;
  districts: readonly string[];
};

/** An existing `DISTRICT_ADMIN` account: nothing to create, maybe assignments to add. */
export type DistrictAdminSkipPlan = {
  username: string;
  userId: string;
  districts: readonly string[];
};

/** One district to add (or already present and not being removed) for one admin. */
export type DistrictAssignmentPlan = {
  username: string;
  userId?: string;
  district: string;
};

/** An existing account whose username/email is held by a non-`DISTRICT_ADMIN` role. */
export type DistrictAdminConflict = {
  username: string;
  existingRole: string;
};

/** A roster district that does not match any known, non-demo `School.district` value. */
export type UnknownDistrictEntry = {
  username: string;
  district: string;
};

/** A roster entry with fewer than 1 or more than 3 districts. */
export type BadDistrictCount = {
  username: string;
  count: number;
};

export type DistrictAdminPlan = {
  create: DistrictAdminCreatePlan[];
  skip: DistrictAdminSkipPlan[];
  addAssignments: DistrictAssignmentPlan[];
  extraAssignments: DistrictAssignmentPlan[];
  conflicts: DistrictAdminConflict[];
  unknownDistricts: UnknownDistrictEntry[];
  badCounts: BadDistrictCount[];
};

const MIN_DISTRICTS = 1;
const MAX_DISTRICTS = 3;

/**
 * A demo tenant's district is never a real assignment target, even if the
 * caller's `knownDistricts` list (built by the script from live data)
 * accidentally includes it — same fail-closed rule as `schoolWhereForScope`
 * always adding `isDemo: false` for a districts scope.
 */
const DEMO_DISTRICT = "[demo district]";

function isKnownDistrict(district: string, knownDistricts: ReadonlySet<string>): boolean {
  if (district === DEMO_DISTRICT) return false;
  return knownDistricts.has(district);
}

/**
 * Classify the roster against what already exists in the database.
 *
 * Priority per roster entry, evaluated independently of every other entry:
 * a bad district count is reported and nothing else is planned for that
 * entry; otherwise an unknown district is reported (every unknown district on
 * that entry, not just the first) and nothing else is planned; otherwise a
 * user matching the entry's username OR email (case-insensitive on email,
 * the same collision surface `scripts/seed-division-admins.ts:74-86` checks)
 * under a different role is a conflict; otherwise an existing
 * `DISTRICT_ADMIN` is skipped (only its missing districts are planned as
 * additions, and its assigned districts absent from the roster are reported
 * as `extraAssignments`, never deleted — see spec Q14); otherwise the entry
 * is planned as a new account with every roster district attached at
 * creation (so those districts do not also appear in `addAssignments`, which
 * is only for districts added to an *existing* row).
 *
 * Matching by email as well as username closes a real hole: a live user can
 * hold the roster's synthetic email under a different or null username (a
 * half-renamed row, a manual fixup). Missing that match would plan a
 * `create`, and the script's own Supabase `listUsers` scan for a "resumable"
 * half-created auth identity would then find that email and call
 * `updateUserById` on the OTHER person's auth account.
 */
export function planDistrictAdmins(
  roster: readonly DistrictAdminRosterEntry[],
  existingUsers: readonly ExistingDistrictAdminUser[],
  knownDistricts: readonly string[]
): DistrictAdminPlan {
  const known = new Set(knownDistricts);
  const byUsername = new Map(existingUsers.map((u) => [u.username, u] as const));
  const byEmail = new Map(existingUsers.map((u) => [u.email.toLowerCase(), u] as const));

  const plan: DistrictAdminPlan = {
    create: [],
    skip: [],
    addAssignments: [],
    extraAssignments: [],
    conflicts: [],
    unknownDistricts: [],
    badCounts: [],
  };

  for (const entry of roster) {
    if (entry.districts.length < MIN_DISTRICTS || entry.districts.length > MAX_DISTRICTS) {
      plan.badCounts.push({ username: entry.username, count: entry.districts.length });
      continue;
    }

    const unknown = entry.districts.filter((d) => !isKnownDistrict(d, known));
    if (unknown.length > 0) {
      for (const district of unknown) {
        plan.unknownDistricts.push({ username: entry.username, district });
      }
      continue;
    }

    const existing = byUsername.get(entry.username) ?? byEmail.get(entry.email.toLowerCase());

    if (!existing) {
      plan.create.push({
        username: entry.username,
        firstName: entry.firstName,
        lastName: entry.lastName,
        districts: entry.districts,
      });
      continue;
    }

    if (existing.role !== "DISTRICT_ADMIN") {
      plan.conflicts.push({ username: entry.username, existingRole: existing.role });
      continue;
    }

    plan.skip.push({ username: entry.username, userId: existing.id, districts: entry.districts });

    const currentDistricts = new Set(existing.districts);
    for (const district of entry.districts) {
      if (!currentDistricts.has(district)) {
        plan.addAssignments.push({ username: entry.username, userId: existing.id, district });
      }
    }

    const rosterDistricts = new Set(entry.districts);
    for (const district of existing.districts) {
      if (!rosterDistricts.has(district)) {
        plan.extraAssignments.push({ username: entry.username, userId: existing.id, district });
      }
    }
  }

  return plan;
}
