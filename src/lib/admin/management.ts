import "server-only";
import type { GradeLevelType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { adminAccounts, adminDashboard, schoolsList } from "@/lib/cache/tags";
import { adminPopulationScope, getAdminIpAndAdvisoryMetrics, getAdminMetricCounts } from "@/lib/dashboard/aggregates";
import { isDemoVisible } from "@/lib/demo/session";
import { ACTIVE_ENROLLED_LEARNER } from "@/lib/learners/population";
import { IP_ETHNICITIES, isIpLearner } from "@/lib/ip/ethnicity";
import { formatPercent, summarizeIpRows } from "@/lib/dashboard/ip-metrics";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { formatListingNameFromRecord } from "@/lib/names";
import {
  ACCOUNTS_PAGE_SIZE,
  ACCOUNT_GRADE_VALUES,
  accountsWhere,
  cleanFilterId,
  cleanFilterText,
  getAccountsPage,
  parseAccountsParams,
  type AccountRow,
  type AccountsParams,
} from "@/lib/admin/accounts";

/**
 * Super Admin "Management" read models: Teachers, School Heads, District
 * Admins, Schools and the division-wide Learners hub.
 *
 * Every function here is cross-tenant by design. Callers are pages that have
 * already run `requireUser("SUPER_ADMIN")`; nothing here may be reached from a
 * School Head or Teacher surface. There is deliberately no `schoolId` scoping to
 * apply — `schoolId` below is a Super Admin's *filter*, never an authorization
 * input.
 *
 * Query-cost rules (about 58k learners, 333 schools): counts come from
 * `groupBy`/`count`, never from loading rows; lists are server-paginated with
 * `skip`/`take` and a stable `id` tiebreaker; no per-row query anywhere.
 *
 * Demo tenant: people, schools and filter options keep demo rows visible, like
 * the existing admin console lists. The learner directory and learner summary
 * follow the dashboard figures instead and exclude the demo school unless the
 * request carries a demo session (`isDemoVisible`).
 */

// ─── Shared helpers ─────────────────────────────────────────────────────────

/** Compact JSON key part — collision-proof for free-text filter values. */
function keyOf(value: unknown): string {
  return JSON.stringify(value);
}

// ─── Teachers / School Heads / District Admins: params + pages ──────────────

/** Raw search params the three people pages accept. All optional, all strings. */
export type PeopleSearchParams = {
  page?: string;
  /** Search: name, email, username, school name or School ID. */
  q?: string;
  schoolId?: string;
  /** `GradeLevelType` — Teachers only (ignored for the other two). */
  grade?: string;
  /** `Section.id` — Teachers only (ignored for the other two). */
  section?: string;
  district?: string;
  sort?: string;
};

/**
 * Teachers list params. Invalid values are dropped, never thrown: unknown
 * `grade`, over-long `section` / `district`, non-positive `page`.
 */
export function parseTeachersParams(
  searchParams: PeopleSearchParams,
  pageSize: number = ACCOUNTS_PAGE_SIZE
): AccountsParams {
  return parseAccountsParams({ ...searchParams, role: "TEACHER" }, pageSize);
}

/** School Heads list params: `q`, `district`, `schoolId` (grade/section dropped). */
export function parseSchoolHeadsParams(
  searchParams: PeopleSearchParams,
  pageSize: number = ACCOUNTS_PAGE_SIZE
): AccountsParams {
  return parseAccountsParams(
    { ...searchParams, role: "SCHOOL_HEAD", grade: undefined, section: undefined },
    pageSize
  );
}

/**
 * District Admins list params: `q`, `district` only. `schoolId` is dropped on
 * purpose — a District Admin has no school, so it would match nothing.
 */
export function parseDistrictAdminsParams(
  searchParams: PeopleSearchParams,
  pageSize: number = ACCOUNTS_PAGE_SIZE
): AccountsParams {
  return parseAccountsParams(
    {
      ...searchParams,
      role: "DISTRICT_ADMIN",
      schoolId: undefined,
      grade: undefined,
      section: undefined,
    },
    pageSize
  );
}

type PeoplePage = { rows: AccountRow[]; totalCount: number };

/**
 * The role is forced here, not trusted from `params`, so a page cannot be
 * tricked into listing another role's credential controls by a hand-edited
 * `?role=`. At most 4 Prisma calls, see `getAccountsPage`.
 */
export function getTeachersPage(params: AccountsParams): Promise<PeoplePage> {
  return getAccountsPage({ ...params, role: "TEACHER" });
}

export function getSchoolHeadsPage(params: AccountsParams): Promise<PeoplePage> {
  return getAccountsPage({
    ...params,
    role: "SCHOOL_HEAD",
    grade: undefined,
    section: undefined,
  });
}

export function getDistrictAdminsPage(params: AccountsParams): Promise<PeoplePage> {
  return getAccountsPage({
    ...params,
    role: "DISTRICT_ADMIN",
    schoolId: undefined,
    grade: undefined,
    section: undefined,
  });
}

// ─── Filter-option loaders ──────────────────────────────────────────────────

export type DistrictOption = { district: string; schools: number };

/**
 * Every district that has at least one live school, alphabetical, with its
 * school count. `School.district` is a free-text column (there is no District
 * table), so this is the only source of "the districts".
 */
export function listDistrictOptions(): Promise<DistrictOption[]> {
  return cachedQuery(
    async () => {
      const groups = await prisma.school.groupBy({
        by: ["district"],
        where: { deletedAt: null, district: { not: null } },
        _count: { _all: true },
      });
      return groups
        .flatMap((g) => (g.district ? [{ district: g.district, schools: g._count._all }] : []))
        .sort((a, b) => a.district.localeCompare(b.district));
    },
    { keyParts: ["admin-district-options"], tags: [schoolsList], profile: "reference" }
  );
}

/**
 * True when at least one live demo school exists. One cached count (`schoolsList`,
 * 5 min), so the Schools page can show its demo caption whichever page of rows
 * is visible. Cross-tenant, Super Admin callers only.
 */
export function demoSchoolExists(): Promise<boolean> {
  return cachedQuery(
    async () => (await prisma.school.count({ where: { deletedAt: null, isDemo: true } })) > 0,
    { keyParts: ["admin-demo-school-exists"], tags: [schoolsList], profile: "reference" }
  );
}

export type SchoolOption = {
  id: string;
  name: string;
  schoolIdCode: string;
  district: string | null;
};

/** Live schools for a school dropdown, name order; optionally one district only. */
export function listSchoolOptions(opts: { district?: string } = {}): Promise<SchoolOption[]> {
  const district = cleanFilterText(opts.district);
  return cachedQuery(
    () =>
      prisma.school.findMany({
        where: { deletedAt: null, ...(district ? { district } : {}) },
        select: { id: true, name: true, schoolIdCode: true, district: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
      }),
    {
      keyParts: ["admin-school-options", keyOf({ district })],
      tags: [schoolsList],
      profile: "reference",
    }
  );
}

export type GradeOption = { value: GradeLevelType; label: string };

/** The 13 gradeable levels in teaching order. `FLOATING` is an advisory mode, not a grade. */
export function listGradeOptions(): GradeOption[] {
  return ACCOUNT_GRADE_VALUES.map((value) => ({
    value,
    label: GRADE_LEVEL_LABELS[value] ?? value,
  }));
}

export type SectionOption = {
  id: string;
  name: string;
  grade: GradeLevelType;
  gradeLabel: string;
};

/**
 * Live sections of one school, optionally narrowed to a grade. A section only
 * makes sense inside a school, so no `schoolId` returns an empty list rather
 * than every section in the division. Not cached: one school's sections are a
 * handful of rows and an admin who just added one expects to see it.
 */
export async function listSectionOptions(opts: {
  schoolId?: string;
  grade?: string;
}): Promise<SectionOption[]> {
  const schoolId = cleanFilterId(opts.schoolId);
  if (!schoolId) return [];
  const grade = ACCOUNT_GRADE_VALUES.find((g) => g === opts.grade);
  const sections = await prisma.section.findMany({
    where: {
      schoolId,
      deletedAt: null,
      gradeLevel: { deletedAt: null, ...(grade ? { type: grade } : {}) },
    },
    select: { id: true, name: true, gradeLevel: { select: { type: true } } },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 300,
  });
  return sections
    .map((s) => ({
      id: s.id,
      name: s.name,
      grade: s.gradeLevel.type,
      gradeLabel: GRADE_LEVEL_LABELS[s.gradeLevel.type] ?? s.gradeLevel.type,
    }))
    .sort(
      (a, b) =>
        ACCOUNT_GRADE_VALUES.indexOf(a.grade) - ACCOUNT_GRADE_VALUES.indexOf(b.grade) ||
        a.name.localeCompare(b.name)
    );
}
// ─── Summaries: Teachers / School Heads / District Admins / Schools ─────────
//
// Every card here is defined to agree with the Super Admin dashboard
// (`getAdminMetricCounts`, `getAdminIpAndAdvisoryMetrics`):
//  - the demo school is scoped by `adminPopulationScope`, the same helper the
//    dashboard uses;
//  - the where clauses are the dashboard's own (deliberately NOT
//    `accountsWhere`, which also hides users of soft-deleted schools — the
//    dashboard does not);
//  - with no filter set, the matching cards are read straight from the
//    dashboard's own cached functions, so both pages read the same cache entry.
// With a filter the same definitions are re-run plus the filter.
// The summaries ignore `q`: cards describe the filtered scope, not a search.

/** Filters the people summaries honour — a subset of the list's `AccountsParams`. */
export type PeopleSummaryFilter = Partial<
  Pick<AccountsParams, "district" | "schoolId" | "grade" | "section">
>;

/**
 * Dashboard-style filter for TEACHER / SCHOOL_HEAD users: live accounts of the
 * role, demo school scoped like the dashboard, plus the optional filters.
 */
function peopleBase(
  role: "TEACHER" | "SCHOOL_HEAD",
  f: { district?: string; schoolId?: string; grade?: GradeLevelType; section?: string },
  demoVisible: boolean
): Prisma.UserWhereInput {
  const { viaSchool } = adminPopulationScope(demoVisible);
  const and: Prisma.UserWhereInput[] = [{ role, deletedAt: null }, viaSchool];
  if (f.district) and.push({ school: { district: f.district } });
  if (f.schoolId) and.push({ schoolId: f.schoolId });
  if (f.grade || f.section) {
    and.push({
      advisorySections: {
        some: {
          deletedAt: null,
          ...(f.section ? { id: f.section } : {}),
          ...(f.grade ? { gradeLevel: { type: f.grade, deletedAt: null } } : {}),
        },
      },
    });
  }
  return { AND: and };
}

export type TeachersSummary = {
  /** Every live teacher in scope, whatever their status (pending, rejected, off, on). */
  total: number;
  /**
   * Live teachers with `isActive = true` — the dashboard's "Teachers" card
   * (`teacherCount`). Unfiltered, this is that number itself.
   */
  activeTeachers: number;
  /** Approved (or legacy, no status) and switched on. Pending teachers are not on, so this is at most `activeTeachers`. */
  active: number;
  /** Not pending/rejected, and switched off. */
  inactive: number;
  /**
   * `approvalStatus = PENDING` — the dashboard's `pendingTeacherApprovals`.
   * Unfiltered, this is that number itself.
   */
  pendingApproval: number;
  rejected: number;
  /** Advisory mode MULTI_GRADE — shown to users as "multi-advisory". */
  multiAdvisory: number;
  /** Advisory mode FLOATING — no advisory section. */
  floating: number;
};

/**
 * Three Prisma calls (cached, tag `adminAccounts`, 60s) plus, when unfiltered,
 * the dashboard's own cached counts.
 */
export async function getTeachersSummary(
  filter: PeopleSummaryFilter = {}
): Promise<TeachersSummary> {
  const demoVisible = await isDemoVisible();
  const f = {
    district: cleanFilterText(filter.district),
    schoolId: cleanFilterId(filter.schoolId),
    grade: filter.grade,
    section: cleanFilterId(filter.section),
  };
  const unfiltered = !f.district && !f.schoolId && !f.grade && !f.section;
  const [summary, dash] = await Promise.all([
    cachedQuery(
      async () => {
        const where = peopleBase("TEACHER", f, demoVisible);
        const [groups, multiAdvisory, floating] = await Promise.all([
          prisma.user.groupBy({
            by: ["isActive", "approvalStatus"],
            where,
            _count: { _all: true },
          }),
          prisma.user.count({
            where: { AND: [where, { teacherProfile: { advisoryMode: "MULTI_GRADE" } }] },
          }),
          prisma.user.count({
            where: { AND: [where, { teacherProfile: { advisoryMode: "FLOATING" } }] },
          }),
        ]);
        const s: TeachersSummary = {
          total: 0,
          activeTeachers: 0,
          active: 0,
          inactive: 0,
          pendingApproval: 0,
          rejected: 0,
          multiAdvisory,
          floating,
        };
        for (const g of groups) {
          const n = g._count._all;
          s.total += n;
          if (g.isActive) s.activeTeachers += n;
          if (g.approvalStatus === "PENDING") s.pendingApproval += n;
          else if (g.approvalStatus === "REJECTED") s.rejected += n;
          else if (g.isActive) s.active += n;
          else s.inactive += n;
        }
        return s;
      },
      {
        keyParts: ["admin-teachers-summary-v2", `demo:${demoVisible}`, keyOf(f)],
        tags: [adminAccounts, adminDashboard],
        profile: "aggregate",
      }
    ),
    unfiltered ? getAdminMetricCounts() : Promise.resolve(null),
  ]);
  if (!dash) return summary;
  return {
    ...summary,
    activeTeachers: dash.teacherCount,
    pendingApproval: dash.pendingTeacherApprovals,
  };
}

export type SchoolHeadsSummary = {
  /** Every live School Head in scope — the dashboard's `schoolHeadCount`. */
  total: number;
  active: number;
  inactive: number;
  /** Still on a first-login/reset credential (`mustChangePassword`). */
  mustChangePassword: number;
  /** Never signed in (`lastLoginAt` is null). */
  neverSignedIn: number;
  /** Live schools in scope (demo scoped like the dashboard) with no live School Head account. */
  schoolsWithoutHead: number;
};

/** Four Prisma calls. Honours `district` and `schoolId`. */
export async function getSchoolHeadsSummary(
  filter: Pick<PeopleSummaryFilter, "district" | "schoolId"> = {}
): Promise<SchoolHeadsSummary> {
  const demoVisible = await isDemoVisible();
  const f = {
    district: cleanFilterText(filter.district),
    schoolId: cleanFilterId(filter.schoolId),
  };
  const [summary, dash] = await Promise.all([
    cachedQuery(
      async () => {
        const where = peopleBase("SCHOOL_HEAD", f, demoVisible);
        const { schoolScope } = adminPopulationScope(demoVisible);
        const [groups, neverSignedIn, schoolsWithoutHead] = await Promise.all([
          prisma.user.groupBy({
            by: ["isActive", "mustChangePassword"],
            where,
            _count: { _all: true },
          }),
          prisma.user.count({ where: { AND: [where, { lastLoginAt: null }] } }),
          prisma.school.count({
            where: {
              deletedAt: null,
              ...schoolScope,
              ...(f.district ? { district: f.district } : {}),
              ...(f.schoolId ? { id: f.schoolId } : {}),
              users: { none: { role: "SCHOOL_HEAD", deletedAt: null } },
            },
          }),
        ]);
        const s: SchoolHeadsSummary = {
          total: 0,
          active: 0,
          inactive: 0,
          mustChangePassword: 0,
          neverSignedIn,
          schoolsWithoutHead,
        };
        for (const g of groups) {
          const n = g._count._all;
          s.total += n;
          if (g.isActive) s.active += n;
          else s.inactive += n;
          if (g.mustChangePassword) s.mustChangePassword += n;
        }
        return s;
      },
      {
        keyParts: ["admin-school-heads-summary-v2", `demo:${demoVisible}`, keyOf(f)],
        tags: [adminAccounts, schoolsList, adminDashboard],
        profile: "aggregate",
      }
    ),
    !f.district && !f.schoolId ? getAdminMetricCounts() : Promise.resolve(null),
  ]);
  return dash ? { ...summary, total: dash.schoolHeadCount } : summary;
}

export type DistrictAdminsSummary = {
  total: number;
  active: number;
  inactive: number;
  /** Districts with at least one live school (demo scoped like the dashboard). */
  districtsTotal: number;
  /** ...of which at least one active, live District Admin is assigned. */
  districtsCovered: number;
  districtsWithoutAdmin: number;
  /** Names of the uncovered districts, alphabetical, capped at 50. */
  uncoveredDistricts: string[];
};

/**
 * Three Prisma calls. Honours `district`. The dashboard has no District Admin
 * card; the district list uses the dashboard's school scope.
 */
export async function getDistrictAdminsSummary(
  filter: Pick<PeopleSummaryFilter, "district"> = {}
): Promise<DistrictAdminsSummary> {
  const demoVisible = await isDemoVisible();
  const f = { district: cleanFilterText(filter.district) };
  return cachedQuery(
    async () => {
      const where = accountsWhere({ role: "DISTRICT_ADMIN", ...f });
      const { schoolScope } = adminPopulationScope(demoVisible);
      const [groups, districtRows, assignmentRows] = await Promise.all([
        prisma.user.groupBy({ by: ["isActive"], where, _count: { _all: true } }),
        prisma.school.groupBy({
          by: ["district"],
          where: {
            deletedAt: null,
            ...schoolScope,
            district: f.district ? f.district : { not: null },
          },
        }),
        prisma.districtAdminAssignment.groupBy({
          by: ["district"],
          where: {
            ...(f.district ? { district: f.district } : {}),
            user: { deletedAt: null, isActive: true, role: "DISTRICT_ADMIN" },
          },
        }),
      ]);
      const covered = new Set(assignmentRows.map((r) => r.district));
      const districts = districtRows.flatMap((r) => (r.district ? [r.district] : []));
      const uncovered = districts.filter((d) => !covered.has(d)).sort((a, b) => a.localeCompare(b));
      const s: DistrictAdminsSummary = {
        total: 0,
        active: 0,
        inactive: 0,
        districtsTotal: districts.length,
        districtsCovered: districts.length - uncovered.length,
        districtsWithoutAdmin: uncovered.length,
        uncoveredDistricts: uncovered.slice(0, 50),
      };
      for (const g of groups) {
        const n = g._count._all;
        s.total += n;
        if (g.isActive) s.active += n;
        else s.inactive += n;
      }
      return s;
    },
    {
      keyParts: ["admin-district-admins-summary-v2", `demo:${demoVisible}`, keyOf(f)],
      tags: [adminAccounts, schoolsList],
      profile: "aggregate",
    }
  );
}

/** Filters the schools summary honours — matches the list's `district` / `region`. */
export type SchoolsSummaryFilter = { district?: string; region?: string };

export type SchoolsSummary = {
  /** Live schools, demo scoped like the dashboard — its `schoolsTotal`. */
  total: number;
  /** Its `schoolsActive`. */
  active: number;
  /** Its `schoolsInactive`. */
  inactive: number;
  /** Distinct named districts among the matching schools. */
  districtCount: number;
  /** Schools with no district recorded. */
  noDistrict: number;
  /** Schools per named district, most schools first (name asc on a tie). */
  byDistrict: { district: string; count: number }[];
};

/** One `groupBy`; unfiltered, total/active/inactive come from the dashboard's own counts. */
export async function getSchoolsSummary(
  filter: SchoolsSummaryFilter = {}
): Promise<SchoolsSummary> {
  const demoVisible = await isDemoVisible();
  const f = {
    district: cleanFilterText(filter.district),
    region: cleanFilterText(filter.region),
  };
  const [summary, dash] = await Promise.all([
    cachedQuery(
      async () => {
        const { schoolScope } = adminPopulationScope(demoVisible);
        const groups = await prisma.school.groupBy({
          by: ["district", "isActive"],
          where: {
            deletedAt: null,
            ...schoolScope,
            ...(f.region ? { region: f.region } : {}),
            ...(f.district ? { district: f.district } : {}),
          },
          _count: { _all: true },
        });
        const s: SchoolsSummary = {
          total: 0,
          active: 0,
          inactive: 0,
          districtCount: 0,
          noDistrict: 0,
          byDistrict: [],
        };
        const perDistrict = new Map<string, number>();
        for (const g of groups) {
          const n = g._count._all;
          s.total += n;
          if (g.isActive) s.active += n;
          else s.inactive += n;
          if (g.district) perDistrict.set(g.district, (perDistrict.get(g.district) ?? 0) + n);
          else s.noDistrict += n;
        }
        s.districtCount = perDistrict.size;
        s.byDistrict = [...perDistrict]
          .map(([district, count]) => ({ district, count }))
          .sort((a, b) => b.count - a.count || a.district.localeCompare(b.district));
        return s;
      },
      {
        keyParts: ["admin-schools-summary-v2", `demo:${demoVisible}`, keyOf(f)],
        tags: [schoolsList, adminDashboard],
        profile: "aggregate",
      }
    ),
    !f.district && !f.region ? getAdminMetricCounts() : Promise.resolve(null),
  ]);
  return dash
    ? {
        ...summary,
        total: dash.schoolsTotal,
        active: dash.schoolsActive,
        inactive: dash.schoolsInactive,
      }
    : summary;
}

// ─── Learners hub ───────────────────────────────────────────────────────────

export const LEARNERS_HUB_PAGE_SIZE = 25;

export type LearnersHubSearchParams = {
  page?: string;
  /** Search by learner name. (There is no LRN column in the schema yet.) */
  q?: string;
  district?: string;
  schoolId?: string;
  /** `GradeLevelType`, KINDER..G12. */
  grade?: string;
  /** `Section.id`. */
  section?: string;
  /** `"yes"` | `"no"`. Anything else means no filter. */
  ip?: string;
  /** `"yes"` | `"no"`. Anything else means no filter. */
  aral?: string;
};

export type LearnersHubParams = {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q: string;
  district?: string;
  schoolId?: string;
  grade?: GradeLevelType;
  section?: string;
  /** true = IP learners only, false = non-IP only, undefined = all. */
  ip?: boolean;
  /** true = ARAL learners only, false = non-ARAL only, undefined = all. */
  aral?: boolean;
};

function yesNo(value: string | undefined): boolean | undefined {
  const v = value?.trim().toLowerCase();
  if (v === "yes") return true;
  if (v === "no") return false;
  return undefined;
}

/** Validates raw searchParams; invalid values are dropped, never thrown. */
export function parseLearnersHubParams(
  searchParams: LearnersHubSearchParams,
  pageSize: number = LEARNERS_HUB_PAGE_SIZE
): LearnersHubParams {
  const rawPage = Number.parseInt(searchParams.page ?? "1", 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const size = pageSize > 0 ? pageSize : LEARNERS_HUB_PAGE_SIZE;
  const q = (searchParams.q ?? "").trim().slice(0, 100);
  const schoolId = cleanFilterId(searchParams.schoolId);
  return {
    page,
    pageSize: size,
    skip: (page - 1) * size,
    take: size,
    q,
    district: cleanFilterText(searchParams.district),
    schoolId,
    grade: ACCOUNT_GRADE_VALUES.find((g) => g === searchParams.grade),
    // A section only has a chip/picker once a school is chosen; without one it
    // would filter rows invisibly, so it is dropped.
    section: schoolId ? cleanFilterId(searchParams.section) : undefined,
    ip: yesNo(searchParams.ip),
    aral: yesNo(searchParams.aral),
  };
}

export function learnersHubTotalPages(
  totalCount: number,
  pageSize: number = LEARNERS_HUB_PAGE_SIZE
): number {
  return totalCount <= 0 ? 1 : Math.ceil(totalCount / pageSize);
}

const IP_VALUES = [...IP_ETHNICITIES];

/**
 * A learner is IP when either ethnicity slot holds an IP value (same rule as
 * the dashboard's `IP_LEARNER`). The "not IP" side is spelled out per slot
 * because a plain `NOT (... IN ...)` drops rows whose ethnicity is NULL.
 */
const IP_LEARNER: Prisma.LearnerWhereInput = {
  OR: [
    { ethnicity: { in: IP_VALUES } },
    { secondaryEthnicity: { in: IP_VALUES } },
  ],
};
const NOT_IP_LEARNER: Prisma.LearnerWhereInput = {
  AND: [
    { OR: [{ ethnicity: null }, { ethnicity: { notIn: IP_VALUES } }] },
    { OR: [{ secondaryEthnicity: null }, { secondaryEthnicity: { notIn: IP_VALUES } }] },
  ],
};

/**
 * The directory lists the dashboard's "Learners" population: every live
 * (`deletedAt: null`) learner, demo school scoped by `adminPopulationScope`. So
 * the unfiltered directory count equals the dashboard Learners card. A learner
 * with no active enrollment still appears, under their current grade/section
 * pointer.
 */
function learnersHubWhere(
  f: Pick<LearnersHubParams, "q" | "district" | "schoolId" | "grade" | "section" | "ip" | "aral">,
  demoVisible: boolean
): Prisma.LearnerWhereInput {
  const and: Prisma.LearnerWhereInput[] = [
    { deletedAt: null },
    adminPopulationScope(demoVisible).viaSchool,
  ];
  if (f.district) and.push({ school: { district: f.district } });
  if (f.schoolId) and.push({ schoolId: f.schoolId });
  if (f.grade) and.push({ gradeLevel: { type: f.grade } });
  if (f.section) and.push({ sectionId: f.section });
  if (f.ip === true) and.push(IP_LEARNER);
  if (f.ip === false) and.push(NOT_IP_LEARNER);
  if (f.aral !== undefined) and.push({ isAralLearner: f.aral });
  if (f.q) and.push({ fullName: { contains: f.q, mode: "insensitive" } });
  return { AND: and };
}

/** One directory row. Deliberately thin: no ethnicity, age, address or contact data. */
export type LearnerHubRow = {
  id: string;
  fullName: string;
  /** Surname-first display form. */
  listingName: string;
  gender: "MALE" | "FEMALE";
  grade: GradeLevelType;
  gradeLabel: string;
  sectionName: string | null;
  school: { id: string; name: string };
  isAral: boolean;
  /** Computed server-side; the ethnicity itself never leaves this module. */
  isIp: boolean;
};

/**
 * Division-wide learner directory page. Not cached (it is a paged list an admin
 * expects fresh). Two Prisma calls (page + count) in one `Promise.all`; the page
 * is one joined SQL statement. Ordered surname, first name, then `id` — the
 * tiebreaker keeps skip/take stable across pages.
 */
export async function getLearnersHubPage(
  params: LearnersHubParams
): Promise<{ rows: LearnerHubRow[]; totalCount: number }> {
  return queryLearnersHub(params, await isDemoVisible());
}

/**
 * School Head "Learners" params. The school is NOT read from `searchParams`:
 * a `?schoolId=` / `?district=` in the URL is discarded, and the caller's own
 * school id (from the session, or `resolveSchoolContext` for a Super Admin
 * view) is the only school the result can carry. Supplying it also keeps the
 * `section` filter (which needs a school).
 */
export function parseSchoolLearnersParams(
  searchParams: Omit<LearnersHubSearchParams, "schoolId" | "district">,
  schoolId: string,
  pageSize: number = LEARNERS_HUB_PAGE_SIZE
): LearnersHubParams {
  return parseLearnersHubParams(
    { ...searchParams, schoolId, district: undefined },
    pageSize
  );
}

/**
 * The learner directory limited to ONE school. `schoolId` is a separate
 * argument that overrides whatever `params.schoolId` / `params.district` hold,
 * so a hand-built params object cannot widen it. The demo-school exclusion is
 * not applied: a School Head of the demo school must see their own learners
 * (the exclusion exists to keep demo rows out of division-wide figures).
 *
 * Callers must take `schoolId` from `requireSchoolUser("SCHOOL_HEAD")` or
 * `resolveSchoolContext`, never from the request.
 */
export function getSchoolLearnersPage(
  schoolId: string,
  params: LearnersHubParams
): Promise<{ rows: LearnerHubRow[]; totalCount: number }> {
  // An empty id is falsy in `learnersHubWhere` and would drop the school filter.
  if (!schoolId) throw new Error("getSchoolLearnersPage requires a schoolId");
  return queryLearnersHub({ ...params, schoolId, district: undefined }, true);
}

async function queryLearnersHub(
  params: LearnersHubParams,
  demoVisible: boolean
): Promise<{ rows: LearnerHubRow[]; totalCount: number }> {
  const where = learnersHubWhere(params, demoVisible);
  const [learners, totalCount] = await Promise.all([
    prisma.learner.findMany({
      relationLoadStrategy: "join",
      where,
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
      skip: params.skip,
      take: params.take,
      select: {
        id: true,
        fullName: true,
        firstName: true,
        middleName: true,
        lastName: true,
        gender: true,
        isAralLearner: true,
        ethnicity: true,
        secondaryEthnicity: true,
        gradeLevel: { select: { type: true } },
        section: { select: { name: true } },
        school: { select: { id: true, name: true } },
      },
    }),
    prisma.learner.count({ where }),
  ]);
  return {
    totalCount,
    rows: learners.map((l) => ({
      id: l.id,
      fullName: l.fullName,
      listingName: formatListingNameFromRecord(l),
      gender: l.gender,
      grade: l.gradeLevel.type,
      gradeLabel: GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
      sectionName: l.section?.name ?? null,
      school: l.school,
      isAral: l.isAralLearner,
      isIp: isIpLearner(l.ethnicity, l.secondaryEthnicity),
    })),
  };
}

export type LearnersSummary = {
  /**
   * Every live learner in scope, demo scoped like the dashboard — its "Learners"
   * card (`learnerCount`). `bySex` and `byGrade` each sum to this.
   */
  totalLearners: number;
  /**
   * Live learners holding an ACTIVE enrollment in an active school year, in live
   * schools — the dashboard's "enrolled" figure (the IP card's denominator).
   */
  enrolledThisYear: number;
  /** Every live learner flagged ARAL — the dashboard's `aralCount`. */
  aralLearners: number;
  /** Enrolled IP learners — the dashboard IP card's `ipLearners`. */
  ipLearners: number;
  /** `ipLearners / enrolledThisYear`, e.g. "33.3%", or "—" when none are enrolled. */
  ipPercent: string;
  /** Enrolled IP learners by group; a learner with two IP groups counts in both. Largest first. */
  ipByGroup: { key: string; name: string; count: number }[];
  bySex: { male: number; female: number };
  /**
   * By the learner's current grade pointer, over `totalLearners`, teaching order
   * (then Floating, then "Unassigned" for a pointer that resolves to no grade).
   * Only buckets with learners appear.
   */
  byGrade: { grade: GradeLevelType | "UNASSIGNED"; label: string; count: number }[];
};

/** Optional scope for the learner summary; no filter means the whole division. */
export type LearnersSummaryFilter = { district?: string; schoolId?: string };

/**
 * Six `groupBy`/`count` calls plus one small grade lookup (about 13 rows per
 * school); no learner rows are loaded. Cached under `adminDashboard` +
 * `schoolsList` (the tags learner create/archive/import and school changes
 * already bust), 60s TTL. Unfiltered, `totalLearners`, `aralLearners`,
 * `enrolledThisYear`, `ipLearners` and `ipPercent` are read from
 * `getAdminMetricCounts` / `getAdminIpAndAdvisoryMetrics`, so they are the
 * dashboard's own cache entries.
 */
export async function getLearnersSummary(
  filter: LearnersSummaryFilter = {},
  opts: { includeDemo?: boolean } = {}
): Promise<LearnersSummary> {
  const demoVisible = opts.includeDemo === true || (await isDemoVisible());
  const f = {
    district: cleanFilterText(filter.district),
    schoolId: cleanFilterId(filter.schoolId),
  };
  const unfiltered = !f.district && !f.schoolId;
  const [summary, counts, ipDash] = await Promise.all([
    cachedQuery(
      async () => {
        const base = learnersHubWhere({ q: "", ...f }, demoVisible);
        // The dashboard's enrolled/IP population also requires a live school.
        const enrolled: Prisma.LearnerWhereInput = {
          AND: [base, ACTIVE_ENROLLED_LEARNER, { school: { deletedAt: null } }],
        };
        const [bySexRows, byGradeLevel, aralLearners, enrolledThisYear, ipRows] =
          await Promise.all([
            prisma.learner.groupBy({ by: ["gender"], where: base, _count: { _all: true } }),
            prisma.learner.groupBy({
              by: ["gradeLevelId"],
              where: base,
              _count: { _all: true },
            }),
            prisma.learner.count({ where: { AND: [base, { isAralLearner: true }] } }),
            prisma.learner.count({ where: enrolled }),
            prisma.learner.groupBy({
              by: ["ethnicity", "secondaryEthnicity"],
              where: { AND: [enrolled, IP_LEARNER] },
              _count: { _all: true },
            }),
          ]);

        // Grade levels are per school, so `gradeLevelId` is folded to the grade
        // type. One small lookup for the ids that actually have learners.
        const gradeRows = byGradeLevel.length
          ? await prisma.gradeLevel.findMany({
              where: { id: { in: byGradeLevel.map((g) => g.gradeLevelId) } },
              select: { id: true, type: true },
            })
          : [];
        const typeById = new Map(gradeRows.map((g) => [g.id, g.type]));
        const perGrade = new Map<GradeLevelType | "UNASSIGNED", number>();
        for (const g of byGradeLevel) {
          const type = typeById.get(g.gradeLevelId) ?? "UNASSIGNED";
          perGrade.set(type, (perGrade.get(type) ?? 0) + g._count._all);
        }

        const bySex = { male: 0, female: 0 };
        for (const r of bySexRows) {
          if (r.gender === "MALE") bySex.male += r._count._all;
          else bySex.female += r._count._all;
        }
        const ip = summarizeIpRows(ipRows);
        const order: (GradeLevelType | "UNASSIGNED")[] = [
          ...ACCOUNT_GRADE_VALUES,
          "FLOATING",
          "UNASSIGNED",
        ];

        return {
          totalLearners: bySex.male + bySex.female,
          enrolledThisYear,
          aralLearners,
          ipLearners: ip.ipCount,
          ipPercent: formatPercent(ip.ipCount, enrolledThisYear),
          ipByGroup: ip.kinds
            .map((k) => ({ key: k.key, name: k.name, count: k.value }))
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
          bySex,
          byGrade: order.flatMap((grade) => {
            const count = perGrade.get(grade) ?? 0;
            return count > 0
              ? [
                  {
                    grade,
                    label: grade === "UNASSIGNED" ? "Unassigned" : (GRADE_LEVEL_LABELS[grade] ?? grade),
                    count,
                  },
                ]
              : [];
          }),
        } satisfies LearnersSummary;
      },
      {
        keyParts: ["admin-learners-summary-v2", `demo:${demoVisible}`, keyOf(f)],
        tags: [adminDashboard, schoolsList],
        profile: "aggregate",
      }
    ),
    unfiltered ? getAdminMetricCounts() : Promise.resolve(null),
    unfiltered ? getAdminIpAndAdvisoryMetrics() : Promise.resolve(null),
  ]);
  return {
    ...summary,
    ...(counts
      ? { totalLearners: counts.learnerCount, aralLearners: counts.aralCount }
      : {}),
    ...(ipDash
      ? {
          enrolledThisYear: ipDash.national.totalLearners,
          ipLearners: ipDash.national.ipLearners,
          ipPercent: ipDash.national.ipPercent,
        }
      : {}),
  };
}

/**
 * Learner overview for ONE school (School Head "Learners" cards). Same figures
 * and definitions as the admin summary, pinned to `schoolId`, which must come
 * from the session / `resolveSchoolContext`. The demo exclusion is skipped so a
 * demo school's own head still sees their learners.
 */
export function getSchoolLearnersSummary(schoolId: string): Promise<LearnersSummary> {
  // An empty id would be cleaned to "no filter" and widen to the division.
  if (!cleanFilterId(schoolId)) throw new Error("getSchoolLearnersSummary requires a schoolId");
  return getLearnersSummary({ schoolId }, { includeDemo: true });
}
