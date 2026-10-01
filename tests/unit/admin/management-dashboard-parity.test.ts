/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Management cards (Schools, School Heads, Teachers, Learners) must show the
 * same numbers as the Super Admin dashboard they sit beside. They did not: the
 * cards used their own definitions (`accountsWhere`, ACTIVE_ENROLLED for the
 * learner total, the demo school in or out depending on the card), so one
 * division showed two different "Teachers" figures.
 *
 * A mocked `count` returning a canned number cannot catch that — the bug is in
 * WHICH rows a where clause selects. So this file runs the real loaders and the
 * real dashboard aggregates against a small in-memory dataset and a minimal
 * Prisma `where` evaluator, then checks three things:
 *   1. unfiltered cards equal the dashboard's values and a hand-computed oracle;
 *   2. every filtered query carries (or omits) the demo exclusion, as the demo
 *      session says, and the per-district cards sum to the dashboard totals;
 *   3. the learner directory's population is the dashboard's, plus the filters.
 *
 * The dataset is built to hit the places the definitions diverge: a demo school,
 * a soft-deleted school WITH people and learners in it, a soft-deleted user, pending / rejected / switched-off
 * teachers, a learner with no enrollment, one enrolled only in an inactive
 * school year, and a learner whose grade pointer resolves to no grade.
 */

// ── fake clock for the demo session ─────────────────────────────────────────
let demoVisible = false;
vi.mock("@/lib/demo/session", () => ({ isDemoVisible: async () => demoVisible }));
const cacheCalls: { keyParts: string[]; tags: string[] }[] = [];
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => unknown, options: { keyParts: string[]; tags: string[] }) => {
    cacheCalls.push({ keyParts: options.keyParts, tags: options.tags });
    return fn();
  },
}));

// ── dataset ─────────────────────────────────────────────────────────────────
const DELETED = new Date("2026-01-01T00:00:00Z");

const SCHOOLS: any[] = [
  { id: "A", name: "Alamada ES", district: "Alamada", isActive: true, isDemo: false, deletedAt: null },
  { id: "B", name: "Alamada NHS", district: "Alamada", isActive: false, isDemo: false, deletedAt: null },
  { id: "C", name: "Banga ES", district: "Banga", isActive: true, isDemo: false, deletedAt: null },
  { id: "D", name: "Demo School", district: "Banga", isActive: true, isDemo: true, deletedAt: null },
  { id: "E", name: "Removed School", district: "Banga", isActive: true, isDemo: false, deletedAt: DELETED },
  { id: "G", name: "Banga NHS", district: "Banga", isActive: true, isDemo: false, deletedAt: null },
];

const GRADE_LEVELS = [
  { id: "gl-k", type: "KINDER" },
  { id: "gl-g3", type: "G3" },
  { id: "gl-float", type: "FLOATING" },
];

function user(id: string, role: string, schoolId: string | null, extra: Record<string, any> = {}) {
  return {
    id,
    role,
    schoolId,
    isActive: true,
    deletedAt: null,
    approvalStatus: role === "TEACHER" ? "APPROVED" : null,
    mustChangePassword: false,
    lastLoginAt: new Date("2026-09-01T00:00:00Z"),
    teacherProfile: role === "TEACHER" ? { advisoryMode: "DEFAULT" } : null,
    advisorySections: [] as any[],
    ...extra,
  };
}

const sectionG3 = { id: "sec1", deletedAt: null, gradeLevel: { type: "G3", deletedAt: null } };

const USERS: any[] = [
  // School Heads
  user("sh-a", "SCHOOL_HEAD", "A"),
  user("sh-b", "SCHOOL_HEAD", "B", { isActive: false, mustChangePassword: true, lastLoginAt: null }),
  user("sh-c", "SCHOOL_HEAD", "C"),
  user("sh-d", "SCHOOL_HEAD", "D"),
  user("sh-e", "SCHOOL_HEAD", "E"),
  user("sh-gone", "SCHOOL_HEAD", "A", { deletedAt: DELETED }),
  // Teachers
  user("t1", "TEACHER", "A", { advisorySections: [sectionG3] }),
  user("t2", "TEACHER", "A", { teacherProfile: { advisoryMode: "FLOATING" } }),
  user("t3", "TEACHER", "B", { isActive: false }),
  user("t4", "TEACHER", "C", { approvalStatus: "PENDING" }),
  user("t5", "TEACHER", "C", { isActive: false, approvalStatus: "REJECTED" }),
  user("t6", "TEACHER", "D"),
  user("t7", "TEACHER", "A", { teacherProfile: { advisoryMode: "MULTI_GRADE" } }),
  user("t8", "TEACHER", "A", { deletedAt: DELETED }),
  // Teachers of the removed school E: live accounts, but their school is gone.
  user("t9", "TEACHER", "E"),
  user("t10", "TEACHER", "E", { approvalStatus: "PENDING" }),
  // Roles with no school
  user("sa", "SUPER_ADMIN", null),
  user("da", "DISTRICT_ADMIN", null),
];

const ENROLLED = [{ status: "ACTIVE", schoolYear: { isActive: true } }];
const ENROLLED_IN_OLD_YEAR = [{ status: "ACTIVE", schoolYear: { isActive: false } }];

function learner(id: string, schoolId: string, extra: Record<string, any> = {}) {
  return {
    id,
    schoolId,
    deletedAt: null,
    isAralLearner: false,
    ethnicity: null,
    secondaryEthnicity: null,
    gender: "MALE",
    gradeLevelId: "gl-g3",
    sectionId: null,
    enrollments: ENROLLED,
    firstName: id,
    middleName: null,
    lastName: "Cruz",
    fullName: `${id} Cruz`,
    ...extra,
  };
}

const LEARNERS: any[] = [
  learner("L1", "A", { isAralLearner: true, ethnicity: "BLAAN", sectionId: "sec1" }),
  learner("L2", "A", { gender: "FEMALE" }),
  // Live, but holds no enrollment: the dashboard's "Learners" counts them, "enrolled" does not.
  learner("L3", "A", { isAralLearner: true, ethnicity: "TBOLI", gender: "FEMALE", gradeLevelId: "gl-k", enrollments: [] }),
  learner("L4", "B", { secondaryEthnicity: "TAGAKAOLO", gradeLevelId: "gl-k" }),
  learner("L5", "C", { enrollments: ENROLLED_IN_OLD_YEAR }),
  learner("L6", "C", { deletedAt: DELETED }),
  learner("L7", "D", { ethnicity: "MARANAO" }),
  learner("L8", "E", { gender: "FEMALE", gradeLevelId: "gl-k" }),
  learner("L9", "C", { gradeLevelId: "gl-float" }),
  learner("L10", "C", { gender: "FEMALE", gradeLevelId: "gl-gone" }),
];

// ── a minimal Prisma `where` evaluator ──────────────────────────────────────
const OPS = new Set(["in", "notIn", "not", "contains", "equals", "some", "none", "every", "mode"]);

function isOperatorObject(v: any): boolean {
  return v && typeof v === "object" && !(v instanceof Date) && Object.keys(v).some((k) => OPS.has(k));
}

function matches(row: any, where: any): boolean {
  if (!where) return true;
  for (const [key, cond] of Object.entries<any>(where)) {
    if (cond === undefined) continue;
    if (key === "AND") {
      if (!(Array.isArray(cond) ? cond : [cond]).every((w: any) => matches(row, w))) return false;
    } else if (key === "OR") {
      if (!cond.some((w: any) => matches(row, w))) return false;
    } else if (key === "NOT") {
      if ((Array.isArray(cond) ? cond : [cond]).some((w: any) => matches(row, w))) return false;
    } else {
      const val = row[key];
      if (cond === null) {
        if (val !== null && val !== undefined) return false;
      } else if (isOperatorObject(cond)) {
        if ("in" in cond && !cond.in.includes(val)) return false;
        // Prisma/SQL: NULL NOT IN (...) is not true, so a null never matches `notIn`.
        if ("notIn" in cond && (val == null || cond.notIn.includes(val))) return false;
        if ("not" in cond) {
          if (cond.not === null ? val == null : val === cond.not) return false;
        }
        if ("contains" in cond && !String(val ?? "").toLowerCase().includes(String(cond.contains).toLowerCase())) return false;
        if ("equals" in cond && val !== cond.equals) return false;
        if ("some" in cond && !(val ?? []).some((x: any) => matches(x, cond.some))) return false;
        if ("none" in cond && (val ?? []).some((x: any) => matches(x, cond.none))) return false;
      } else if (cond && typeof cond === "object" && !(cond instanceof Date)) {
        if (val == null || !matches(val, cond)) return false;
      } else if (val !== cond) return false;
    }
  }
  return true;
}

const schoolOf = (id: string) => SCHOOLS.find((s) => s.id === id);
const gradeOf = (id: string) => GRADE_LEVELS.find((g) => g.id === id);

const tables = {
  school: () => SCHOOLS.map((s) => ({ ...s, users: USERS.filter((u) => u.schoolId === s.id) })),
  user: () => USERS.map((u) => ({ ...u, school: u.schoolId ? schoolOf(u.schoolId) : null })),
  learner: () =>
    LEARNERS.map((l) => ({
      ...l,
      school: schoolOf(l.schoolId),
      // A dangling grade pointer still resolves for the directory join in this
      // fake; the summary folds `gradeLevelId` through the real lookup table.
      gradeLevel: gradeOf(l.gradeLevelId) ?? { type: "G1" },
      section: l.sectionId ? { name: "Rizal" } : null,
    })),
} as const;

const calls: { model: string; method: string; where: any }[] = [];

function model(name: keyof typeof tables) {
  const rows = (where: any) => tables[name]().filter((r) => matches(r, where));
  const record = (method: string, args: any) => calls.push({ model: name, method, where: args?.where });
  return {
    count: async (args: any) => (record("count", args), rows(args?.where).length),
    findMany: async (args: any) => {
      record("findMany", args);
      const sorted = [...rows(args?.where)].sort((a, b) => a.id.localeCompare(b.id));
      return sorted.slice(args?.skip ?? 0, args?.take === undefined ? undefined : (args.skip ?? 0) + args.take);
    },
    groupBy: async (args: any) => {
      record("groupBy", args);
      const groups = new Map<string, any>();
      for (const r of rows(args.where)) {
        const by = Object.fromEntries(args.by.map((k: string) => [k, r[k]]));
        const key = JSON.stringify(by);
        const g = groups.get(key) ?? { ...by, _count: { _all: 0 } };
        g._count._all += 1;
        groups.set(key, g);
      }
      return [...groups.values()];
    },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: model("school"),
    user: model("user"),
    learner: model("learner"),
    gradeLevel: {
      findMany: async (args: any) => {
        calls.push({ model: "gradeLevel", method: "findMany", where: args?.where });
        return GRADE_LEVELS.filter((g) => args.where.id.in.includes(g.id));
      },
    },
    districtAdminAssignment: {
      groupBy: async (args: any) => {
        calls.push({ model: "districtAdminAssignment", method: "groupBy", where: args?.where });
        return [];
      },
    },
  },
}));

const { getAdminMetricCounts, getAdminIpAndAdvisoryMetrics, adminPopulationScope } = await import(
  "@/lib/dashboard/aggregates"
);
const {
  getSchoolsSummary,
  getSchoolHeadsSummary,
  getTeachersSummary,
  getLearnersSummary,
  getDistrictAdminsSummary,
  getLearnersHubPage,
  parseLearnersHubParams,
} = await import("@/lib/admin/management");

beforeEach(() => {
  demoVisible = false;
  calls.length = 0;
  cacheCalls.length = 0;
});

const { accountsWhere } = await import("@/lib/admin/accounts");
const tags = await import("@/lib/cache/tags");

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

// ── (1) unfiltered cards == the dashboard ───────────────────────────────────
describe("unfiltered Management cards equal the dashboard", () => {
  it("dashboard oracle: the dataset yields the hand-computed dashboard figures", async () => {
    const d = await getAdminMetricCounts();
    expect(d).toEqual({
      schoolsTotal: 4, // A, B, C, G — demo hidden, removed school excluded
      schoolsActive: 3,
      schoolsInactive: 1,
      schoolHeadCount: 3, // sh-a, sh-b, sh-c (sh-d demo, sh-e removed school, sh-gone deleted)
      teacherCount: 4, // t1, t2, t4, t7 — on, live, live school (t9 is in the removed school)
      learnerCount: 7, // live learners of live, non-demo schools (L8 is in the removed school)
      aralCount: 2,
      pendingTeacherApprovals: 1,
    });
    const ip = await getAdminIpAndAdvisoryMetrics();
    expect(ip.national.totalLearners).toBe(5); // enrolled in a live school
    expect(ip.national.ipLearners).toBe(2);
    expect(ip.national.ipPercent).toBe("40.0%");
  });

  it("Schools: total, active and inactive are the dashboard's", async () => {
    const d = await getAdminMetricCounts();
    const s = await getSchoolsSummary();
    expect(s.total).toBe(d.schoolsTotal);
    expect(s.active).toBe(d.schoolsActive);
    expect(s.inactive).toBe(d.schoolsInactive);
    expect(s.total).toBe(4);
    expect(s.byDistrict).toEqual([
      { district: "Alamada", count: 2 },
      { district: "Banga", count: 2 },
    ]);
  });

  it("School Heads: total is the dashboard's schoolHeadCount", async () => {
    const d = await getAdminMetricCounts();
    const s = await getSchoolHeadsSummary();
    expect(s.total).toBe(d.schoolHeadCount);
    expect(s.total).toBe(3);
    expect(s.active).toBe(2);
    expect(s.inactive).toBe(1);
    expect(s.schoolsWithoutHead).toBe(1); // Banga NHS
  });

  it("Teachers: activeTeachers is teacherCount and pendingApproval is pendingTeacherApprovals", async () => {
    const d = await getAdminMetricCounts();
    const s = await getTeachersSummary();
    expect(s.activeTeachers).toBe(d.teacherCount);
    expect(s.pendingApproval).toBe(d.pendingTeacherApprovals);
    expect(s).toMatchObject({
      total: 6,
      activeTeachers: 4,
      active: 3, // approved and on; the pending teacher is on but not "active"
      inactive: 1,
      pendingApproval: 1,
      rejected: 1,
      multiAdvisory: 1,
      floating: 1,
    });
  });

  it("Learners: total, ARAL, enrolled and IP are the dashboard's figures", async () => {
    const d = await getAdminMetricCounts();
    const ip = await getAdminIpAndAdvisoryMetrics();
    const s = await getLearnersSummary();
    expect(s.totalLearners).toBe(d.learnerCount);
    expect(s.aralLearners).toBe(d.aralCount);
    expect(s.enrolledThisYear).toBe(ip.national.totalLearners);
    expect(s.ipLearners).toBe(ip.national.ipLearners);
    expect(s.ipPercent).toBe(ip.national.ipPercent);
  });

  it("Learners: the total is NOT the enrolled figure (a learner with no enrollment is still counted)", async () => {
    const s = await getLearnersSummary();
    expect(s.totalLearners).toBe(7);
    expect(s.enrolledThisYear).toBe(5);
  });

  it("Learners: sex and grade buckets each add up to the total, incl. FLOATING and UNASSIGNED", async () => {
    const s = await getLearnersSummary();
    expect(s.bySex).toEqual({ male: 4, female: 3 });
    expect(s.byGrade).toEqual([
      { grade: "KINDER", label: expect.any(String), count: 2 },
      { grade: "G3", label: expect.any(String), count: 3 },
      { grade: "FLOATING", label: expect.any(String), count: 1 },
      { grade: "UNASSIGNED", label: "Unassigned", count: 1 },
    ]);
    expect(s.bySex.male + s.bySex.female).toBe(s.totalLearners);
    expect(s.byGrade.reduce((n, g) => n + g.count, 0)).toBe(s.totalLearners);
  });

  it("with the demo session on, cards and dashboard still agree (and both grow)", async () => {
    demoVisible = true;
    const d = await getAdminMetricCounts();
    const ip = await getAdminIpAndAdvisoryMetrics();
    expect(d).toMatchObject({ schoolsTotal: 5, schoolHeadCount: 4, teacherCount: 5, learnerCount: 8 });
    expect((await getSchoolsSummary()).total).toBe(5);
    expect((await getSchoolHeadsSummary()).total).toBe(4);
    expect((await getTeachersSummary()).activeTeachers).toBe(5);
    const l = await getLearnersSummary();
    expect(l.totalLearners).toBe(8);
    expect(l.enrolledThisYear).toBe(ip.national.totalLearners);
    expect(l.ipLearners).toBe(ip.national.ipLearners);
  });
});

// ── filtered cards use the same definitions ─────────────────────────────────
describe("filtered cards use the dashboard's definitions", () => {
  it("per-district Teachers cards add up to the dashboard's teacher figures", async () => {
    const d = await getAdminMetricCounts();
    const a = await getTeachersSummary({ district: "Alamada" });
    const b = await getTeachersSummary({ district: "Banga" });
    expect(a).toMatchObject({ total: 4, activeTeachers: 3, pendingApproval: 0, floating: 1, multiAdvisory: 1 });
    expect(b).toMatchObject({ total: 2, activeTeachers: 1, pendingApproval: 1, rejected: 1 });
    expect(a.activeTeachers + b.activeTeachers).toBe(d.teacherCount);
    expect(a.pendingApproval + b.pendingApproval).toBe(d.pendingTeacherApprovals);
  });

  it("per-district School Heads cards add up to the dashboard's schoolHeadCount", async () => {
    const d = await getAdminMetricCounts();
    const a = await getSchoolHeadsSummary({ district: "Alamada" });
    const b = await getSchoolHeadsSummary({ district: "Banga" });
    expect(a).toMatchObject({ total: 2, active: 1, inactive: 1, mustChangePassword: 1, neverSignedIn: 1, schoolsWithoutHead: 0 });
    // The head of a removed school is counted by neither the dashboard nor the cards.
    expect(b).toMatchObject({ total: 1, schoolsWithoutHead: 1 });
    expect(a.total + b.total).toBe(d.schoolHeadCount);
  });

  it("per-district Schools cards add up to the dashboard's school figures", async () => {
    const d = await getAdminMetricCounts();
    const a = await getSchoolsSummary({ district: "Alamada" });
    const b = await getSchoolsSummary({ district: "Banga" });
    expect(a).toMatchObject({ total: 2, active: 1, inactive: 1 });
    expect(b).toMatchObject({ total: 2, active: 2, inactive: 0 });
    expect(a.total + b.total).toBe(d.schoolsTotal);
  });

  it("per-district Learners cards add up to the dashboard's learner figures", async () => {
    const d = await getAdminMetricCounts();
    const ip = await getAdminIpAndAdvisoryMetrics();
    const a = await getLearnersSummary({ district: "Alamada" });
    const b = await getLearnersSummary({ district: "Banga" });
    expect(a).toMatchObject({ totalLearners: 4, aralLearners: 2, enrolledThisYear: 3, ipLearners: 2, ipPercent: "66.7%" });
    expect(a.bySex).toEqual({ male: 2, female: 2 });
    // L8 sits in a removed school: it is in no card at all.
    expect(b).toMatchObject({ totalLearners: 3, enrolledThisYear: 2, ipLearners: 0 });
    expect(a.totalLearners + b.totalLearners).toBe(d.learnerCount);
    expect(a.aralLearners + b.aralLearners).toBe(d.aralCount);
    expect(a.enrolledThisYear + b.enrolledThisYear).toBe(ip.national.totalLearners);
    expect(a.ipLearners + b.ipLearners).toBe(ip.national.ipLearners);
  });

  it("a school filter narrows to that school", async () => {
    expect(await getLearnersSummary({ schoolId: "A" })).toMatchObject({ totalLearners: 3, enrolledThisYear: 2 });
    expect(await getTeachersSummary({ schoolId: "A" })).toMatchObject({ total: 3, activeTeachers: 3 });
    expect(await getSchoolHeadsSummary({ schoolId: "A" })).toMatchObject({ total: 1 });
  });

  it("grade and section teacher filters reach the advisory relation", async () => {
    expect(await getTeachersSummary({ grade: "G3" })).toMatchObject({ total: 1 });
    expect(await getTeachersSummary({ section: "sec1", schoolId: "A" })).toMatchObject({ total: 1 });
    expect(await getTeachersSummary({ section: "nope", schoolId: "A" })).toMatchObject({ total: 0 });
  });
});

// ── (2) demo scope on every filtered query ──────────────────────────────────
describe("demo scope is applied to every filtered summary query", () => {
  const filtered: [string, () => Promise<unknown>, string[]][] = [
    ["getSchoolsSummary", () => getSchoolsSummary({ district: "Banga" }), ["school"]],
    ["getSchoolHeadsSummary", () => getSchoolHeadsSummary({ district: "Banga" }), ["school", "user"]],
    ["getTeachersSummary", () => getTeachersSummary({ district: "Banga" }), ["user"]],
    ["getLearnersSummary", () => getLearnersSummary({ district: "Banga" }), ["learner"]],
    ["getDistrictAdminsSummary", () => getDistrictAdminsSummary({ district: "Banga" }), ["school"]],
  ];

  const hasDemoExclusion = (where: unknown) => JSON.stringify(where ?? {}).includes('"isDemo":false');
  const mentionsDemo = (where: unknown) => JSON.stringify(where ?? {}).includes("isDemo");
  // The district-admin user query has a null school by definition; the grade
  // lookup and assignment table carry no tenant data.
  const scopedCalls = (models: string[]) =>
    calls.filter((c) => models.includes(c.model) && !(c.model === "user" && JSON.stringify(c.where).includes("DISTRICT_ADMIN")));

  it.each(filtered)("%s: demo hidden -> every query excludes the demo school", async (_name, run, models) => {
    demoVisible = false;
    await run();
    const relevant = scopedCalls(models);
    expect(relevant.length).toBeGreaterThan(0);
    for (const c of relevant) {
      expect(hasDemoExclusion(c.where), `${c.model}.${c.method} ${JSON.stringify(c.where)}`).toBe(true);
    }
  });

  it.each(filtered)("%s: demo visible -> no query mentions the demo flag", async (_name, run) => {
    demoVisible = true;
    await run();
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(mentionsDemo(c.where), `${c.model}.${c.method} ${JSON.stringify(c.where)}`).toBe(false);
    }
  });

  it("the demo school's people and learners never reach a filtered card when hidden", async () => {
    // Demo school D is in Banga: it must not be in Banga's counts...
    expect((await getSchoolsSummary({ district: "Banga" })).total).toBe(2);
    expect((await getSchoolHeadsSummary({ district: "Banga" })).total).toBe(1);
    expect((await getLearnersSummary({ district: "Banga" })).totalLearners).toBe(3);
    // ...and is, once the demo session is on.
    demoVisible = true;
    expect((await getSchoolsSummary({ district: "Banga" })).total).toBe(3);
    expect((await getSchoolHeadsSummary({ district: "Banga" })).total).toBe(2);
    expect((await getLearnersSummary({ district: "Banga" })).totalLearners).toBe(4);
    expect((await getTeachersSummary({ district: "Banga" })).total).toBe(3);
  });
});

// ── (3) learner directory population ────────────────────────────────────────
describe("getLearnersHubPage uses the dashboard's learner population", () => {
  const page = (sp: Record<string, string>) => getLearnersHubPage(parseLearnersHubParams(sp));

  it("unfiltered, it lists exactly the learners the dashboard counts, not only the enrolled", async () => {
    const d = await getAdminMetricCounts();
    const r = await page({});
    expect(r.totalCount).toBe(d.learnerCount);
    // L3 has no enrollment and L5 is enrolled only in a closed year: both are listed.
    expect(ids(r.rows)).toEqual(["L1", "L10", "L2", "L3", "L4", "L5", "L9"].sort());
    expect(ids(r.rows)).not.toContain("L8"); // removed school
  });

  it("excludes soft-deleted learners and, hidden, the demo school; includes it when visible", async () => {
    expect(ids((await page({})).rows)).not.toContain("L6");
    expect(ids((await page({})).rows)).not.toContain("L7");
    demoVisible = true;
    expect(ids((await page({})).rows)).toContain("L7");
  });

  it("where = live + demo scope + filters, with no enrollment clause", async () => {
    await page({ district: "Alamada", schoolId: "A", grade: "G3", ip: "yes", aral: "yes", q: "L1" });
    const where = calls.find((c) => c.model === "learner" && c.method === "count")!.where;
    const text = JSON.stringify(where);
    expect(text).not.toContain("enrollments");
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { deletedAt: null },
        { school: { deletedAt: null, isDemo: false } },
        { school: { district: "Alamada" } },
        { schoolId: "A" },
        { gradeLevel: { type: "G3" } },
        { isAralLearner: true },
      ])
    );
  });

  it("the population before filters is the dashboard's learnerCount where-clause", async () => {
    // Same rows as the dashboard's own learner query, evaluated on the same data.
    const scope = adminPopulationScope(false);
    const dashboardRows = tables.learner().filter((l) => matches(l, { deletedAt: null, ...scope.viaSchool }));
    expect(ids((await page({})).rows)).toEqual(ids(dashboardRows));
  });

  it.each([
    [{ district: "Alamada" }, ["L1", "L2", "L3", "L4"]],
    [{ schoolId: "C" }, ["L10", "L5", "L9"]],
    [{ grade: "KINDER" }, ["L3", "L4"]],
    [{ aral: "yes" }, ["L1", "L3"]],
    [{ aral: "no" }, ["L10", "L2", "L4", "L5", "L9"]],
    [{ ip: "yes" }, ["L1", "L3", "L4"]],
    [{ ip: "no" }, ["L10", "L2", "L5", "L9"]],
    [{ schoolId: "A", section: "sec1" }, ["L1"]],
    [{ q: "l1" }, ["L1", "L10"]],
    [{ district: "Alamada", ip: "yes", aral: "yes" }, ["L1", "L3"]],
  ] as [Record<string, string>, string[]][])("filter %j", async (sp, expected) => {
    expect(ids((await page(sp)).rows)).toEqual([...expected].sort());
  });

  it("an orphan section (no school) is dropped and does not filter", async () => {
    expect((await page({ section: "sec1" })).totalCount).toBe(7);
  });
});

// ── (4) adminPopulationScope ────────────────────────────────────────────────
describe("adminPopulationScope", () => {
  it("demo hidden: excludes demo schools directly, and removed + demo schools through the relation", () => {
    expect(adminPopulationScope(false)).toEqual({
      schoolScope: { isDemo: false },
      viaSchool: { school: { deletedAt: null, isDemo: false } },
    });
  });

  it("demo visible: still requires a live school, but lets the demo school through", () => {
    expect(adminPopulationScope(true)).toEqual({
      schoolScope: {},
      viaSchool: { school: { deletedAt: null } },
    });
  });

  it("viaSchool rejects the people and learners of a removed school, in both demo modes", () => {
    for (const visible of [false, true]) {
      const { viaSchool } = adminPopulationScope(visible);
      for (const id of ["sh-e", "t9", "t10"]) {
        expect(matches(tables.user().find((u) => u.id === id)!, viaSchool), id).toBe(false);
      }
      expect(matches(tables.learner().find((l) => l.id === "L8")!, viaSchool)).toBe(false);
      expect(matches(tables.user().find((u) => u.id === "t1")!, viaSchool)).toBe(true);
    }
  });

  it("returns a fresh object each call, so spreading it into a where cannot leak between queries", () => {
    const a = adminPopulationScope(false);
    const b = adminPopulationScope(false);
    expect(a).not.toBe(b);
    expect(a.viaSchool).not.toBe(b.viaSchool);
  });

  it("viaSchool never matches a role with no school (a relation filter needs a school)", () => {
    // The dashboard never counts SUPER_ADMIN or DISTRICT_ADMIN through it, and neither do the cards.
    const nullSchoolUser = tables.user().find((u) => u.id === "sa")!;
    expect(matches(nullSchoolUser, adminPopulationScope(false).viaSchool)).toBe(false);
    expect(matches(nullSchoolUser, adminPopulationScope(true).viaSchool)).toBe(false);
  });
});

// ── a removed school's people and learners are counted nowhere ──────────────
describe("a removed school is counted by the dashboard, the cards and the lists alike", () => {
  // The lists do not hide the demo school, so compare with the demo session on.
  const page = (sp: Record<string, string>) => getLearnersHubPage(parseLearnersHubParams(sp));
  const listCount = (table: "user" | "learner", where: any) =>
    tables[table]().filter((r) => matches(r, where)).length;

  it.each([false, true])("demo visible=%s: its teacher, head and learner are in none of them", async (visible) => {
    demoVisible = visible;
    const removed = { teacher: "t9", pendingTeacher: "t10", head: "sh-e", learner: "L8" };

    // dashboard
    const d = await getAdminMetricCounts();
    const liveTeachers = USERS.filter(
      (u) => u.role === "TEACHER" && !u.deletedAt && u.isActive && schoolOf(u.schoolId)?.deletedAt === null && (visible || !schoolOf(u.schoolId)!.isDemo)
    );
    expect(d.teacherCount).toBe(liveTeachers.length);
    expect(liveTeachers.map((u) => u.id)).not.toContain(removed.teacher);
    expect(d.pendingTeacherApprovals).toBe(1); // t4 only; t10 is pending in the removed school

    // cards
    const teachers = await getTeachersSummary();
    expect(teachers.total).toBe(visible ? 7 : 6); // never t9 / t10
    expect(teachers.pendingApproval).toBe(1);
    expect((await getSchoolHeadsSummary()).total).toBe(d.schoolHeadCount);
    expect((await getLearnersSummary()).totalLearners).toBe(d.learnerCount);

    // the lists (what the Super Admin pages show)
    const teacherList = accountsWhere({ role: "TEACHER" });
    const listed = tables.user().filter((u) => matches(u, teacherList)).map((u) => u.id);
    expect(listed).not.toContain(removed.teacher);
    expect(listed).not.toContain(removed.pendingTeacher);
    expect(listed).not.toContain(removed.head);
    const headList = tables.user().filter((u) => matches(u, accountsWhere({ role: "SCHOOL_HEAD" }))).map((u) => u.id);
    expect(headList).not.toContain(removed.head);
    // Lists do not hide the demo school, so they only equal the dashboard when it is shown too.
    if (visible) expect(headList.length).toBe(d.schoolHeadCount);
    expect(ids((await page({})).rows)).not.toContain(removed.learner);
    expect((await page({})).totalCount).toBe(d.learnerCount);
  });

  it("the account lists agree with the dashboard figure they sit beside (demo on, so neither hides the demo school)", async () => {
    demoVisible = true;
    const d = await getAdminMetricCounts();
    expect(listCount("user", { AND: [accountsWhere({ role: "SCHOOL_HEAD" })] })).toBe(d.schoolHeadCount);
    expect(listCount("user", { AND: [accountsWhere({ role: "TEACHER" }), { isActive: true }] })).toBe(d.teacherCount);
    expect((await page({})).totalCount).toBe(d.learnerCount);
  });

  it("filtering to the removed school's district never resurrects them", async () => {
    // L8, t9, t10 and sh-e are all in Banga, whose live schools are C and G.
    expect((await getLearnersSummary({ district: "Banga" })).totalLearners).toBe(3);
    expect((await getTeachersSummary({ district: "Banga" })).total).toBe(2);
    expect((await getSchoolHeadsSummary({ district: "Banga" })).total).toBe(1);
    expect((await getLearnersSummary({ schoolId: "E" })).totalLearners).toBe(0);
    expect((await getTeachersSummary({ schoolId: "E" })).total).toBe(0);
    expect((await getSchoolHeadsSummary({ schoolId: "E" })).total).toBe(0);
  });
});

// ── cache keys and tags (cachedQuery is a recording stub, not a pass-through) ─
describe("cachedQuery keyParts and tags", () => {
  const summaryCall = (prefix: string) => {
    const c = cacheCalls.find((x) => x.keyParts[0] === prefix);
    expect(c, `no cachedQuery call with key ${prefix}`).toBeDefined();
    return c!;
  };

  const FILTER = { district: "Alamada", schoolId: "A", grade: "G3" as const, section: "sec1" };

  const loaders: [string, string, () => Promise<unknown>, () => Promise<unknown>, string[], string[]][] = [
    ["teachers", "admin-teachers-summary-v2", () => getTeachersSummary(FILTER), () => getTeachersSummary(),
      ["Alamada", "A", "G3", "sec1"], [tags.adminAccounts, tags.adminDashboard]],
    ["school heads", "admin-school-heads-summary-v2", () => getSchoolHeadsSummary({ district: "Alamada", schoolId: "A" }), () => getSchoolHeadsSummary(),
      ["Alamada", "A"], [tags.adminAccounts, tags.schoolsList, tags.adminDashboard]],
    ["district admins", "admin-district-admins-summary-v2", () => getDistrictAdminsSummary({ district: "Alamada" }), () => getDistrictAdminsSummary(),
      ["Alamada"], [tags.adminAccounts, tags.schoolsList]],
    ["schools", "admin-schools-summary-v2", () => getSchoolsSummary({ district: "Alamada", region: "Region XII" }), () => getSchoolsSummary(),
      ["Alamada", "Region XII"], [tags.schoolsList, tags.adminDashboard]],
    ["learners", "admin-learners-summary-v2", () => getLearnersSummary({ district: "Alamada", schoolId: "A" }), () => getLearnersSummary(),
      ["Alamada", "A"], [tags.adminDashboard, tags.schoolsList]],
  ];

  it.each(loaders)("%s: every filter value appears in keyParts", async (_n, key, filtered, _unfiltered, values) => {
    await filtered();
    const text = JSON.stringify(summaryCall(key).keyParts);
    for (const v of values) expect(text, v).toContain(v);
  });

  it.each(loaders)("%s: the demo flag is in keyParts and flips the key", async (_n, key, _f, unfiltered) => {
    demoVisible = false;
    await unfiltered();
    const hidden = summaryCall(key).keyParts;
    cacheCalls.length = 0;
    demoVisible = true;
    await unfiltered();
    const shown = summaryCall(key).keyParts;
    expect(hidden).toContain("demo:false");
    expect(shown).toContain("demo:true");
    expect(hidden).not.toEqual(shown);
  });

  it.each(loaders)("%s: a different filter never shares a cache key with an unfiltered read", async (_n, key, filtered, unfiltered) => {
    await filtered();
    const withFilter = summaryCall(key).keyParts;
    cacheCalls.length = 0;
    await unfiltered();
    expect(summaryCall(key).keyParts).not.toEqual(withFilter);
  });

  it.each(loaders)("%s: tags include what busts it", async (_n, key, filtered, _u, _v, expectedTags) => {
    await filtered();
    expect(summaryCall(key).tags).toEqual(expect.arrayContaining(expectedTags));
  });

  it("two different filter values give two different keys", async () => {
    await getTeachersSummary({ district: "Alamada" });
    const a = summaryCall("admin-teachers-summary-v2").keyParts;
    cacheCalls.length = 0;
    await getTeachersSummary({ district: "Banga" });
    expect(summaryCall("admin-teachers-summary-v2").keyParts).not.toEqual(a);
  });

  it("the dashboard counts carry the demo flag in their key and the adminDashboard tag", async () => {
    await getAdminMetricCounts();
    const c = summaryCall("admin-metric-counts");
    expect(c.keyParts).toContain("demo:false");
    expect(c.tags).toContain(tags.adminDashboard);
    cacheCalls.length = 0;
    await getAdminIpAndAdvisoryMetrics();
    expect(summaryCall("admin-ip-advisory-metrics-v2").keyParts).toContain("demo:false");
    expect(summaryCall("admin-ip-advisory-metrics-v2").tags).toContain(tags.adminDashboard);
  });

  it("an unfiltered card also reads the dashboard's own cache entry (same key as the dashboard itself)", async () => {
    await getTeachersSummary();
    const keys = cacheCalls.map((c) => c.keyParts[0]);
    expect(keys).toContain("admin-metric-counts");
    cacheCalls.length = 0;
    await getLearnersSummary();
    expect(cacheCalls.map((c) => c.keyParts[0])).toEqual(
      expect.arrayContaining(["admin-metric-counts", "admin-ip-advisory-metrics-v2"])
    );
  });

  it("a filtered card does not read the dashboard's entries", async () => {
    await getTeachersSummary({ district: "Alamada" });
    expect(cacheCalls.map((c) => c.keyParts[0])).not.toContain("admin-metric-counts");
  });
});
