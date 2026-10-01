import "server-only";
import type { GradeLevelType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { cachedQuery } from "@/lib/cache/unstable";
import { adminAccounts, adminDashboard, schoolsList } from "@/lib/cache/tags";
import { schoolsWhere } from "@/lib/cache/schools-list";
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

/** Filters the people summaries honour — a subset of the list's `AccountsParams`. */
export type PeopleSummaryFilter = Partial<
  Pick<AccountsParams, "district" | "schoolId" | "grade" | "section">
>;

export type TeachersSummary = {
  /** Every live teacher matching the filters. */
  total: number;
  /** Approved (or legacy, no status) and switched on. */
  active: number;
  /** Approved but switched off. */
  inactive: number;
  /** Self-registered, awaiting a School Head's approval. */
  pendingApproval: number;
  rejected: number;
  /** Advisory mode MULTI_GRADE — shown to users as "multi-advisory". */
  multiAdvisory: number;
  /** Advisory mode FLOATING — no advisory section. */
  floating: number;
};

/**
 * Three Prisma calls: one `groupBy` for the status split and two filtered
 * counts for the advisory modes. Cached under `adminAccounts` (busted by
 * account mutations and by School Head teacher approvals), 60s TTL.
 */
export function getTeachersSummary(filter: PeopleSummaryFilter = {}): Promise<TeachersSummary> {
  const f = {
    district: cleanFilterText(filter.district),
    schoolId: cleanFilterId(filter.schoolId),
    grade: filter.grade,
    section: cleanFilterId(filter.section),
  };
  return cachedQuery(
    async () => {
      const where = accountsWhere({ role: "TEACHER", ...f });
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
      const summary: TeachersSummary = {
        total: 0,
        active: 0,
        inactive: 0,
        pendingApproval: 0,
        rejected: 0,
        multiAdvisory,
        floating,
      };
      for (const g of groups) {
        const n = g._count._all;
        summary.total += n;
        if (g.approvalStatus === "PENDING") summary.pendingApproval += n;
        else if (g.approvalStatus === "REJECTED") summary.rejected += n;
        else if (g.isActive) summary.active += n;
        else summary.inactive += n;
      }
      return summary;
    },
    {
      keyParts: ["admin-teachers-summary", keyOf(f)],
      tags: [adminAccounts],
      profile: "aggregate",
    }
  );
}

export type SchoolHeadsSummary = {
  total: number;
  active: number;
  inactive: number;
  /** Still on a first-login/reset credential (`mustChangePassword`). */
  mustChangePassword: number;
  /** Never signed in (`lastLoginAt` is null). */
  neverSignedIn: number;
  /** Live schools in the filter with no live School Head account at all. */
  schoolsWithoutHead: number;
};

/** Four Prisma calls. Honours `district` and `schoolId`. */
export function getSchoolHeadsSummary(
  filter: Pick<PeopleSummaryFilter, "district" | "schoolId"> = {}
): Promise<SchoolHeadsSummary> {
  const f = {
    district: cleanFilterText(filter.district),
    schoolId: cleanFilterId(filter.schoolId),
  };
  return cachedQuery(
    async () => {
      const where = accountsWhere({ role: "SCHOOL_HEAD", ...f });
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
            ...(f.district ? { district: f.district } : {}),
            ...(f.schoolId ? { id: f.schoolId } : {}),
            users: { none: { role: "SCHOOL_HEAD", deletedAt: null } },
          },
        }),
      ]);
      const summary: SchoolHeadsSummary = {
        total: 0,
        active: 0,
        inactive: 0,
        mustChangePassword: 0,
        neverSignedIn,
        schoolsWithoutHead,
      };
      for (const g of groups) {
        const n = g._count._all;
        summary.total += n;
        if (g.isActive) summary.active += n;
        else summary.inactive += n;
        if (g.mustChangePassword) summary.mustChangePassword += n;
      }
      return summary;
    },
    {
      keyParts: ["admin-school-heads-summary", keyOf(f)],
      tags: [adminAccounts, schoolsList],
      profile: "aggregate",
    }
  );
}

export type DistrictAdminsSummary = {
  total: number;
  active: number;
  inactive: number;
  /** Districts with at least one live school (demo excluded, as in a district admin's scope). */
  districtsTotal: number;
  /** ...of which at least one active, live District Admin is assigned. */
  districtsCovered: number;
  districtsWithoutAdmin: number;
  /** Names of the uncovered districts, alphabetical, capped at 50. */
  uncoveredDistricts: string[];
};

/** Three Prisma calls. Honours `district`. */
export function getDistrictAdminsSummary(
  filter: Pick<PeopleSummaryFilter, "district"> = {}
): Promise<DistrictAdminsSummary> {
  const f = { district: cleanFilterText(filter.district) };
  return cachedQuery(
    async () => {
      const where = accountsWhere({ role: "DISTRICT_ADMIN", ...f });
      const [groups, districtRows, assignmentRows] = await Promise.all([
        prisma.user.groupBy({ by: ["isActive"], where, _count: { _all: true } }),
        prisma.school.groupBy({
          by: ["district"],
          where: {
            deletedAt: null,
            isDemo: false,
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
      const summary: DistrictAdminsSummary = {
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
        summary.total += n;
        if (g.isActive) summary.active += n;
        else summary.inactive += n;
      }
      return summary;
    },
    {
      keyParts: ["admin-district-admins-summary", keyOf(f)],
      tags: [adminAccounts, schoolsList],
      profile: "aggregate",
    }
  );
}

/** Filters the schools summary honours — matches the list's `district` / `region`. */
export type SchoolsSummaryFilter = { district?: string; region?: string };

export type SchoolsSummary = {
  total: number;
  active: number;
  inactive: number;
  /** Distinct named districts among the matching schools. */
  districtCount: number;
  /** Schools with no district recorded. */
  noDistrict: number;
  /** Schools per named district, most schools first (name asc on a tie). */
  byDistrict: { district: string; count: number }[];
};

/** One `groupBy`. Uses `schoolsWhere` so the cards and the table describe the same rows. */
export function getSchoolsSummary(filter: SchoolsSummaryFilter = {}): Promise<SchoolsSummary> {
  const f = {
    district: cleanFilterText(filter.district) ?? "",
    region: cleanFilterText(filter.region) ?? "",
  };
  return cachedQuery(
    async () => {
      const groups = await prisma.school.groupBy({
        by: ["district", "isActive"],
        where: schoolsWhere({ q: "", region: f.region, status: "", district: f.district }),
        _count: { _all: true },
      });
      const summary: SchoolsSummary = {
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
        summary.total += n;
        if (g.isActive) summary.active += n;
        else summary.inactive += n;
        if (g.district) perDistrict.set(g.district, (perDistrict.get(g.district) ?? 0) + n);
        else summary.noDistrict += n;
      }
      summary.districtCount = perDistrict.size;
      summary.byDistrict = [...perDistrict]
        .map(([district, count]) => ({ district, count }))
        .sort((a, b) => b.count - a.count || a.district.localeCompare(b.district));
      return summary;
    },
    {
      keyParts: ["admin-schools-summary", keyOf(f)],
      tags: [schoolsList],
      profile: "aggregate",
    }
  );
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
 * The learner population is `ACTIVE_ENROLLED_LEARNER` (live learners with an
 * ACTIVE enrollment in an active school year) — the same rule every dashboard
 * and the division summary count, so this hub's totals agree with them. It
 * includes `deletedAt: null`. The demo school is excluded unless
 * `demoVisible`.
 */
function learnersHubWhere(
  f: Pick<LearnersHubParams, "q" | "district" | "schoolId" | "grade" | "section" | "ip" | "aral">,
  demoVisible: boolean
): Prisma.LearnerWhereInput {
  const and: Prisma.LearnerWhereInput[] = [ACTIVE_ENROLLED_LEARNER];
  if (!demoVisible) and.push({ school: { isDemo: false } });
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
  const demoVisible = await isDemoVisible();
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
  totalLearners: number;
  /** Teaching order, only grades that have learners. */
  byGrade: { grade: GradeLevelType; label: string; count: number }[];
  bySex: { male: number; female: number };
  ipLearners: number;
  /** "12.5%" or "—" when there are no learners. */
  ipPercent: string;
  /** A learner with two IP groups counts in both. Largest first. */
  ipByGroup: { key: string; name: string; count: number }[];
  aralLearners: number;
};

/** Optional scope for the learner summary; no filter means the whole division. */
export type LearnersSummaryFilter = { district?: string; schoolId?: string };

/**
 * Five Prisma calls, all `groupBy`/`count`, no rows loaded except the grade
 * lookup (one row per grade level, about 13 per school). Same population as the
 * dashboard IP card, so unfiltered figures match it. Cached under
 * `adminDashboard` + `schoolsList` — the tags learner create/archive/import
 * (`revalidateLearnerScoped({ adminDashboard: true })`) and school changes
 * already bust — with a 60s TTL as the backstop.
 */
export async function getLearnersSummary(
  filter: LearnersSummaryFilter = {}
): Promise<LearnersSummary> {
  const demoVisible = await isDemoVisible();
  const f = {
    district: cleanFilterText(filter.district),
    schoolId: cleanFilterId(filter.schoolId),
  };
  return cachedQuery(
    async () => {
      const base = learnersHubWhere(
        { q: "", district: f.district, schoolId: f.schoolId },
        demoVisible
      );
      const [byGradeLevel, bySexRows, ipRows, aralLearners] = await Promise.all([
        prisma.learner.groupBy({
          by: ["gradeLevelId"],
          where: base,
          _count: { _all: true },
        }),
        prisma.learner.groupBy({ by: ["gender"], where: base, _count: { _all: true } }),
        prisma.learner.groupBy({
          by: ["ethnicity", "secondaryEthnicity"],
          where: { AND: [base, IP_LEARNER] },
          _count: { _all: true },
        }),
        prisma.learner.count({ where: { AND: [base, { isAralLearner: true }] } }),
      ]);

      // Grade levels are per school, so `gradeLevelId` must be folded to the
      // grade type. One small lookup for the ids that actually have learners.
      const gradeRows = byGradeLevel.length
        ? await prisma.gradeLevel.findMany({
            where: { id: { in: byGradeLevel.map((g) => g.gradeLevelId) } },
            select: { id: true, type: true },
          })
        : [];
      const typeById = new Map(gradeRows.map((g) => [g.id, g.type]));
      const perGrade = new Map<GradeLevelType, number>();
      for (const g of byGradeLevel) {
        const type = typeById.get(g.gradeLevelId);
        if (type) perGrade.set(type, (perGrade.get(type) ?? 0) + g._count._all);
      }

      const sex = { male: 0, female: 0 };
      for (const r of bySexRows) {
        if (r.gender === "MALE") sex.male += r._count._all;
        else sex.female += r._count._all;
      }
      const totalLearners = sex.male + sex.female;
      const ip = summarizeIpRows(ipRows);

      return {
        totalLearners,
        byGrade: ACCOUNT_GRADE_VALUES.flatMap((grade) => {
          const count = perGrade.get(grade) ?? 0;
          return count > 0
            ? [{ grade, label: GRADE_LEVEL_LABELS[grade] ?? grade, count }]
            : [];
        }),
        bySex: sex,
        ipLearners: ip.ipCount,
        ipPercent: formatPercent(ip.ipCount, totalLearners),
        ipByGroup: ip.kinds
          .map((k) => ({ key: k.key, name: k.name, count: k.value }))
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
        aralLearners,
      };
    },
    {
      keyParts: ["admin-learners-summary", `demo:${demoVisible}`, keyOf(f)],
      tags: [adminDashboard, schoolsList],
      profile: "aggregate",
    }
  );
}
