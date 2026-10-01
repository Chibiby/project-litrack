import { describe, expect, it, vi } from "vitest";

/**
 * Filter parsing and `where` builders behind the Super Admin Management pages
 * (Teachers, School Heads, District Admins, Schools, Learners). All pure; the
 * heavy imports are stubbed only so the modules load.
 */

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock("@/lib/demo/session", () => ({ isDemoVisible: vi.fn(async () => false) }));

const { accountsWhere, parseAccountsParams } = await import("@/lib/admin/accounts");
const {
  parseTeachersParams,
  parseSchoolHeadsParams,
  parseDistrictAdminsParams,
  parseLearnersHubParams,
  LEARNERS_HUB_PAGE_SIZE,
} = await import("@/lib/admin/management");
const { parseSchoolsListParams, schoolsWhere } = await import("@/lib/cache/schools-list");

type WhereWithAnd = { AND?: unknown[]; advisorySections?: unknown };
const andOf = (w: unknown) => (w as WhereWithAnd).AND ?? [];

describe("parseAccountsParams — section and district", () => {
  it("keeps a section id for teachers once a school is chosen, trimmed", () => {
    expect(
      parseAccountsParams({ role: "TEACHER", schoolId: "school-1", section: "  sec-1 " }).section
    ).toBe("sec-1");
  });

  it("drops a section when no school is chosen (the picker is disabled without one)", () => {
    expect(parseAccountsParams({ role: "TEACHER", section: "sec-1" }).section).toBeUndefined();
    expect(parseAccountsParams({ role: "TEACHER", schoolId: "  ", section: "sec-1" }).section).toBeUndefined();
    expect(parseTeachersParams({ section: "sec-1" }).section).toBeUndefined();
    expect(parseTeachersParams({ section: "sec-1", schoolId: "school-1" }).section).toBe("sec-1");
  });

  it("an orphan section never reaches the where clause", () => {
    const w = accountsWhere(parseTeachersParams({ section: "sec-1" }));
    expect(w.advisorySections).toBeUndefined();
  });

  it("drops section unless the role is TEACHER, even with a school", () => {
    expect(parseAccountsParams({ schoolId: "s", section: "sec-1" }).section).toBeUndefined();
    expect(parseAccountsParams({ role: "SCHOOL_HEAD", schoolId: "s", section: "sec-1" }).section).toBeUndefined();
    expect(parseAccountsParams({ role: "DISTRICT_ADMIN", schoolId: "s", section: "sec-1" }).section).toBeUndefined();
  });

  it("drops an empty, blank or over-long (>64) section", () => {
    const base = { role: "TEACHER", schoolId: "school-1" };
    expect(parseAccountsParams({ ...base, section: "" }).section).toBeUndefined();
    expect(parseAccountsParams({ ...base, section: "   " }).section).toBeUndefined();
    expect(parseAccountsParams({ ...base, section: "x".repeat(65) }).section).toBeUndefined();
    expect(parseAccountsParams({ ...base, section: "x".repeat(64) }).section).toBe("x".repeat(64));
  });

  it("keeps a district for any role (or none), trimmed", () => {
    expect(parseAccountsParams({ district: " Alamada " }).district).toBe("Alamada");
    expect(parseAccountsParams({ role: "SCHOOL_HEAD", district: "Alamada" }).district).toBe("Alamada");
    expect(parseAccountsParams({ role: "DISTRICT_ADMIN", district: "Alamada" }).district).toBe("Alamada");
  });

  it("drops a blank or over-long (>120) district and accepts exactly 120", () => {
    expect(parseAccountsParams({ district: "  " }).district).toBeUndefined();
    expect(parseAccountsParams({ district: "d".repeat(121) }).district).toBeUndefined();
    expect(parseAccountsParams({ district: "d".repeat(120) }).district).toBe("d".repeat(120));
  });

  it("still drops an invalid grade, an unknown role, and a non-positive page", () => {
    const p = parseAccountsParams({ role: "TEACHER", grade: "G13", page: "-4" });
    expect(p.grade).toBeUndefined();
    expect(p.page).toBe(1);
    expect(parseAccountsParams({ role: "ADMIN" }).role).toBeUndefined();
    expect(parseAccountsParams({ role: "TEACHER", grade: "FLOATING" }).grade).toBeUndefined();
    expect(parseAccountsParams({ role: "TEACHER", grade: "G3" }).grade).toBe("G3");
  });
});

describe("accountsWhere — section filter", () => {
  it("matches the teacher's live advisory section by id", () => {
    const w = accountsWhere({ role: "TEACHER", section: "sec-1" });
    expect(w.advisorySections).toEqual({ some: { deletedAt: null, id: "sec-1" } });
  });

  it("requires grade and section on the SAME section row (one `some`)", () => {
    const w = accountsWhere({ role: "TEACHER", grade: "G3", section: "sec-1" });
    expect(w.advisorySections).toEqual({
      some: { deletedAt: null, id: "sec-1", gradeLevel: { type: "G3", deletedAt: null } },
    });
  });

  it("adds no advisory clause without grade or section", () => {
    expect(accountsWhere({ role: "TEACHER" }).advisorySections).toBeUndefined();
  });
});

describe("accountsWhere — district filter", () => {
  const viaSchool = { school: { district: "Alamada" } };
  const viaAssignment = { districtAssignments: { some: { district: "Alamada" } } };

  it("district admins match through their district assignments, not a school", () => {
    const and = andOf(accountsWhere({ role: "DISTRICT_ADMIN", district: "Alamada" }));
    expect(and).toContainEqual(viaAssignment);
    expect(and).not.toContainEqual(viaSchool);
    expect(JSON.stringify(and)).not.toContain('"school":{"district"');
  });

  it("teachers and school heads match through their school's district", () => {
    for (const role of ["TEACHER", "SCHOOL_HEAD"] as const) {
      const and = andOf(accountsWhere({ role, district: "Alamada" }));
      expect(and).toContainEqual(viaSchool);
      expect(JSON.stringify(and)).not.toContain("districtAssignments");
    }
  });

  it("with no role, matches either a school district or an assignment", () => {
    const and = andOf(accountsWhere({ district: "Alamada" }));
    expect(and).toContainEqual({ OR: [viaSchool, viaAssignment] });
  });

  it("adds no district clause when district is absent, and keeps the soft-delete guards", () => {
    const w = accountsWhere({ role: "TEACHER" });
    expect(JSON.stringify(w)).not.toContain("district");
    expect(w.deletedAt).toBeNull();
    // Teachers of a removed school must not surface.
    expect(andOf(w)).toContainEqual({ OR: [{ schoolId: null }, { school: { deletedAt: null } }] });
  });

  it("keeps district AND search as independent constraints", () => {
    const w = accountsWhere({ role: "TEACHER", district: "Alamada", q: "cruz" });
    expect(andOf(w)).toContainEqual(viaSchool);
    expect(w.OR).toBeDefined();
  });
});

describe("per-role Management param parsers", () => {
  const dirty = {
    page: "2",
    q: " cruz ",
    schoolId: "school-1",
    grade: "G4",
    section: "sec-9",
    district: "Alamada",
    sort: "school",
  };

  it("Teachers: forces TEACHER and keeps school, grade, section, district", () => {
    const p = parseTeachersParams({ ...dirty });
    expect(p).toMatchObject({
      role: "TEACHER",
      q: "cruz",
      schoolId: "school-1",
      grade: "G4",
      section: "sec-9",
      district: "Alamada",
      sort: "school",
      page: 2,
    });
  });

  it("Teachers: a hand-edited role cannot change the role (the role is not a search param)", () => {
    expect(parseTeachersParams({ ...dirty, role: "SUPER_ADMIN" } as never).role).toBe("TEACHER");
  });

  it("School Heads: forces SCHOOL_HEAD and drops grade and section", () => {
    const p = parseSchoolHeadsParams({ ...dirty });
    expect(p.role).toBe("SCHOOL_HEAD");
    expect(p.grade).toBeUndefined();
    expect(p.section).toBeUndefined();
    expect(p.schoolId).toBe("school-1");
    expect(p.district).toBe("Alamada");
  });

  it("District Admins: forces DISTRICT_ADMIN and drops schoolId, grade and section", () => {
    const p = parseDistrictAdminsParams({ ...dirty });
    expect(p.role).toBe("DISTRICT_ADMIN");
    expect(p.schoolId).toBeUndefined();
    expect(p.grade).toBeUndefined();
    expect(p.section).toBeUndefined();
    expect(p.district).toBe("Alamada");
    expect(p.q).toBe("cruz");
  });

  it("District Admins: the resulting where has no school constraint, so it can still match", () => {
    const p = parseDistrictAdminsParams({ ...dirty });
    const w = accountsWhere(p);
    expect(w.schoolId).toBeUndefined();
    expect(w.advisorySections).toBeUndefined();
    expect(andOf(w)).toContainEqual({ districtAssignments: { some: { district: "Alamada" } } });
  });

  it("drops invalid values instead of throwing", () => {
    const p = parseTeachersParams({
      page: "abc",
      grade: "G99",
      district: "d".repeat(500),
      schoolId: "school-1",
      section: "s".repeat(500),
    });
    expect(p).toMatchObject({ page: 1, skip: 0 });
    expect(p.grade).toBeUndefined();
    expect(p.district).toBeUndefined();
    expect(p.section).toBeUndefined();
  });
});

describe("parseLearnersHubParams", () => {
  it("accepts yes/no for ip and aral, case-insensitively and trimmed", () => {
    expect(parseLearnersHubParams({ ip: "yes", aral: "no" })).toMatchObject({ ip: true, aral: false });
    expect(parseLearnersHubParams({ ip: " YES ", aral: "No" })).toMatchObject({ ip: true, aral: false });
  });

  it("drops any other ip/aral value, meaning no filter", () => {
    for (const bad of ["true", "1", "maybe", "", "y", "on", "null"]) {
      const p = parseLearnersHubParams({ ip: bad, aral: bad });
      expect(p.ip, `ip=${bad}`).toBeUndefined();
      expect(p.aral, `aral=${bad}`).toBeUndefined();
    }
    expect(parseLearnersHubParams({}).ip).toBeUndefined();
  });

  it("validates grade against KINDER..G12 and drops FLOATING and junk", () => {
    expect(parseLearnersHubParams({ grade: "KINDER" }).grade).toBe("KINDER");
    expect(parseLearnersHubParams({ grade: "G12" }).grade).toBe("G12");
    expect(parseLearnersHubParams({ grade: "FLOATING" }).grade).toBeUndefined();
    expect(parseLearnersHubParams({ grade: "g3" }).grade).toBeUndefined();
    expect(parseLearnersHubParams({ grade: "G13" }).grade).toBeUndefined();
  });

  it("drops a section when no school is chosen, and keeps it with one", () => {
    expect(parseLearnersHubParams({ section: "sec-1" }).section).toBeUndefined();
    expect(parseLearnersHubParams({ section: "sec-1", schoolId: " " }).section).toBeUndefined();
    expect(parseLearnersHubParams({ section: "sec-1", schoolId: "school-1" }).section).toBe("sec-1");
  });

  it("drops a section whose school was dropped for being over-long", () => {
    expect(
      parseLearnersHubParams({ section: "sec-1", schoolId: "x".repeat(65) })
    ).toMatchObject({ schoolId: undefined, section: undefined });
  });

  it("trims and caps free text: q at 100 characters, school/section ids at 64, district at 120", () => {
    expect(parseLearnersHubParams({ q: "  maria  " }).q).toBe("maria");
    expect(parseLearnersHubParams({ q: "a".repeat(150) }).q).toHaveLength(100);
    expect(parseLearnersHubParams({ schoolId: "x".repeat(65) }).schoolId).toBeUndefined();
    expect(parseLearnersHubParams({ schoolId: "s", section: "x".repeat(65) }).section).toBeUndefined();
    expect(parseLearnersHubParams({ district: "x".repeat(121) }).district).toBeUndefined();
    expect(parseLearnersHubParams({ district: " Alamada " }).district).toBe("Alamada");
  });

  it("falls back to page 1 on bad pages and paginates with the hub page size", () => {
    expect(parseLearnersHubParams({ page: "0" }).page).toBe(1);
    expect(parseLearnersHubParams({ page: "-3" }).page).toBe(1);
    expect(parseLearnersHubParams({ page: "x" }).page).toBe(1);
    expect(parseLearnersHubParams({ page: "3" })).toMatchObject({
      page: 3,
      pageSize: LEARNERS_HUB_PAGE_SIZE,
      skip: 2 * LEARNERS_HUB_PAGE_SIZE,
      take: LEARNERS_HUB_PAGE_SIZE,
    });
  });
});

describe("Schools list district filter", () => {
  it("parses and trims a district", () => {
    expect(parseSchoolsListParams({ district: " Alamada " }).district).toBe("Alamada");
    expect(parseSchoolsListParams({}).district).toBe("");
  });

  it("drops a district longer than 120 characters", () => {
    expect(parseSchoolsListParams({ district: "d".repeat(121) }).district).toBe("");
    expect(parseSchoolsListParams({ district: "d".repeat(120) }).district).toBe("d".repeat(120));
  });

  it("filters by exact district, not a substring", () => {
    expect(schoolsWhere({ q: "", region: "", status: "", district: "Alamada" })).toEqual({
      deletedAt: null,
      district: "Alamada",
    });
  });

  it("applies no district clause when the district is empty", () => {
    const w = schoolsWhere({ q: "", region: "", status: "", district: "" });
    expect(w).toEqual({ deletedAt: null });
  });

  it("always excludes soft-deleted schools and combines with region and status", () => {
    const w = schoolsWhere({ q: "", region: "Region XII", status: "active", district: "Alamada" });
    expect(w).toEqual({ deletedAt: null, region: "Region XII", isActive: true, district: "Alamada" });
  });
});
