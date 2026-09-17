import { beforeEach, describe, expect, it, vi } from "vitest";
import { testLabPersonaEmail } from "@/lib/test-lab/personas";

/**
 * Page Test Lab fixtures (docs/test-lab-spec.md, T2) — `prepareTestLabFixtures`
 * and the `prepareTestLab` action that wraps it.
 *
 * What is pinned here:
 *   - `assertTestableSchool` is a genuine second check: even a school
 *     `findDemoSchools()` claims to have found is refused, and nothing is
 *     written, if that fresh lookup disagrees.
 *   - Every write is idempotent: calling `prepareTestLabFixtures` twice
 *     creates no second School Year, grade, section, auth user or learner.
 *   - `prepareTestLab` asks `requireUser("SUPER_ADMIN")` before touching
 *     `findDemoSchools` or anything else.
 *   - The `TEST_LAB_PREPARE` audit row carries ids and counts only — never an
 *     email, a name, or the generated teacher password.
 */

// ── fake tables ──────────────────────────────────────────────────────────

type School = { id: string; isDemo: boolean; deletedAt: Date | null };
type Year = { id: string; schoolId: string; label: string; isActive: boolean; startDate: Date; endDate: Date };
type Grade = { id: string; schoolId: string; type: string; deletedAt: Date | null };
type Sec = { id: string; schoolId: string; gradeLevelId: string; name: string; adviserId: string | null; deletedAt: Date | null };
type Usr = {
  id: string;
  authId: string;
  email: string;
  role: string;
  schoolId: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  profileCompleted: boolean;
  approvalStatus: string | null;
  approvedAt: Date | null;
  approvedById: string | null;
  deletedAt: Date | null;
};
type Profile = { userId: string; advisoryMode: string };
type LearnerRow = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  sectionId: string;
  teacherId: string;
  aralTeacherId: string | null;
  isAralLearner: boolean;
  deletedAt: Date | null;
};
type EnrollmentRow = {
  id: string;
  learnerId: string;
  schoolId: string;
  schoolYearId: string;
  gradeLevelId: string;
  sectionId: string;
  teacherId: string;
  status: string;
};

let schools: School[];
let years: Year[];
let grades: Grade[];
let sections: Sec[];
let users: Usr[];
let profiles: Profile[];
let learners: LearnerRow[];
let enrollments: EnrollmentRow[];
let idCounter = 0;

function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

function matches<T extends Record<string, unknown>>(row: T, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (value !== null && typeof value === "object" && "in" in (value as Record<string, unknown>)) {
      const list = (value as { in: unknown[] }).in;
      if (!list.includes(row[key])) return false;
    } else if (row[key] !== value) {
      return false;
    }
  }
  return true;
}

const prismaMock = {
  school: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const row = schools.find((s) => matches(s, where));
      return row ? { isDemo: row.isDemo } : null;
    }),
  },
  schoolYear: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return years.find((y) => matches(y, where)) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Omit<Year, "id"> }) => {
      const row: Year = { id: nextId("year"), ...data };
      years.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Year> }) => {
      const row = years.find((y) => y.id === where.id);
      if (!row) throw new Error("year not found");
      Object.assign(row, data);
      return row;
    }),
  },
  gradeLevel: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return grades.find((g) => matches(g, where)) ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return grades.filter((g) => matches(g, where));
    }),
    create: vi.fn(async ({ data }: { data: { schoolId: string; type: string } }) => {
      const row: Grade = { id: nextId("grade"), deletedAt: null, ...data };
      grades.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Grade> }) => {
      const row = grades.find((g) => g.id === where.id);
      if (!row) throw new Error("grade not found");
      Object.assign(row, data);
      return row;
    }),
  },
  section: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return sections.find((s) => matches(s, where)) ?? null;
    }),
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return sections.filter((s) => matches(s, where)).map((s) => ({ id: s.id, gradeLevelId: s.gradeLevelId }));
    }),
    create: vi.fn(async ({ data }: { data: { schoolId: string; gradeLevelId: string; name: string } }) => {
      const row: Sec = { id: nextId("section"), adviserId: null, deletedAt: null, ...data };
      sections.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Sec> }) => {
      const row = sections.find((s) => s.id === where.id);
      if (!row) throw new Error("section not found");
      Object.assign(row, data);
      return row;
    }),
  },
  user: {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return users.find((u) => matches(u, where)) ?? null;
    }),
    create: vi.fn(async ({ data }: { data: Partial<Usr> & { authId: string; email: string; role: string } }) => {
      const row: Usr = {
        id: nextId("user"),
        schoolId: null,
        approvalStatus: null,
        approvedAt: null,
        approvedById: null,
        deletedAt: null,
        isActive: false,
        mustChangePassword: false,
        profileCompleted: false,
        firstName: "",
        lastName: "",
        fullName: "",
        ...data,
      } as Usr;
      users.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Usr> }) => {
      const row = users.find((u) => u.id === where.id);
      if (!row) throw new Error("user not found");
      Object.assign(row, data);
      return row;
    }),
  },
  teacherProfile: {
    create: vi.fn(async ({ data }: { data: Profile }) => {
      profiles.push(data);
      return data;
    }),
  },
  learner: {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      return learners.filter((l) => matches(l, where));
    }),
    create: vi.fn(async ({ data }: { data: Omit<LearnerRow, "id" | "deletedAt"> }) => {
      const row: LearnerRow = { id: nextId("learner"), deletedAt: null, ...data };
      learners.push(row);
      return row;
    }),
  },
  enrollment: {
    create: vi.fn(async ({ data }: { data: Omit<EnrollmentRow, "id"> }) => {
      const row: EnrollmentRow = { id: nextId("enrollment"), ...data };
      enrollments.push(row);
      return row;
    }),
  },
  $transaction: vi.fn(async (cb: (tx: typeof prismaMock) => unknown) => cb(prismaMock)),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// ── other collaborators ─────────────────────────────────────────────────

const findDemoSchoolsMock = vi.fn(async (): Promise<{ id: string }[]> => []);
vi.mock("@/lib/demo/provision", () => ({
  findDemoSchools: () => findDemoSchoolsMock(),
  provisionDemoTenant: vi.fn(),
  resetDemoTenant: vi.fn(),
}));

let authUserCounter = 0;
const createUserMock = vi.fn(async (_args?: unknown) => {
  authUserCounter += 1;
  return { data: { user: { id: `auth-${authUserCounter}` } }, error: null };
});
const updateUserByIdMock = vi.fn(async (..._args: unknown[]) => ({ data: {}, error: null }));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    auth: {
      admin: {
        createUser: (args: unknown) => createUserMock(args),
        updateUserById: (...args: unknown[]) => updateUserByIdMock(...args),
      },
    },
  }),
}));

const setTeacherAdvisoryMock = vi.fn(
  async (_tx: unknown, params: { teacherId: string; change: { op: string; sectionId?: string } }) => {
    if (params.change.op === "add" && params.change.sectionId) {
      const section = sections.find((s) => s.id === params.change.sectionId);
      if (section) section.adviserId = params.teacherId;
    }
    return { sectionIds: [], gradeLevelIds: [] };
  }
);
vi.mock("@/lib/teachers/section-assignment", () => ({
  setTeacherAdvisory: (...args: unknown[]) =>
    setTeacherAdvisoryMock(...(args as [unknown, { teacherId: string; change: { op: string; sectionId?: string } }])),
}));

const writeAuditMock = vi.fn(async (_entry?: unknown) => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAuditMock(...args),
  AUDIT_ACTIONS: { TEST_LAB_PREPARE: "TEST_LAB_PREPARE" },
}));

const requireUserMock = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUserMock(...args),
}));

const revalidatePathMock = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePathMock(...args) }));

vi.mock("@/lib/cache/revalidate", () => ({
  revalidateAdminDashboard: vi.fn(),
  revalidateSchoolsList: vi.fn(),
}));

vi.mock("@/lib/settings/system-settings", () => ({
  writeSetting: vi.fn(),
}));

const { prepareTestLabFixtures, findTestLabFixtures } = await import("@/lib/demo/test-fixtures");
const { prepareTestLab } = await import("@/lib/actions/demo");
const { redirect } = await import("next/navigation");

const SCHOOL_ID = "school-demo-1";
const ADMIN_ID = "admin-1";
const HEAD_EMAIL = testLabPersonaEmail("head");

function seedLiveDemoSchool(): void {
  schools = [{ id: SCHOOL_ID, isDemo: true, deletedAt: null }];
  findDemoSchoolsMock.mockResolvedValue([{ id: SCHOOL_ID }]);
}

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  authUserCounter = 0;
  schools = [];
  years = [];
  grades = [];
  sections = [];
  users = [];
  profiles = [];
  learners = [];
  enrollments = [];
  findDemoSchoolsMock.mockResolvedValue([]);
});

describe("prepareTestLabFixtures — refusal", () => {
  it("refuses and writes nothing when the school found is not isDemo", async () => {
    // `findDemoSchools()` reports a school, but the fresh `assertTestableSchool`
    // re-check says it is not demo — the defense-in-depth path.
    findDemoSchoolsMock.mockResolvedValue([{ id: SCHOOL_ID }]);
    schools = [{ id: SCHOOL_ID, isDemo: false, deletedAt: null }];

    await expect(prepareTestLabFixtures(ADMIN_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(years).toHaveLength(0);
    expect(grades).toHaveLength(0);
    expect(sections).toHaveLength(0);
    expect(users).toHaveLength(0);
    expect(learners).toHaveLength(0);
    expect(createUserMock).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("refuses when no demo school exists at all", async () => {
    findDemoSchoolsMock.mockResolvedValue([]);

    await expect(prepareTestLabFixtures(ADMIN_ID)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(years).toHaveLength(0);
  });
});

describe("prepareTestLabFixtures — idempotency", () => {
  it("creates the full fixture set once, and creates nothing new on a second run", async () => {
    seedLiveDemoSchool();
    users.push({
      id: "head-1",
      authId: "auth-head",
      email: HEAD_EMAIL,
      role: "SCHOOL_HEAD",
      schoolId: SCHOOL_ID,
      firstName: "",
      lastName: "",
      fullName: "[demo school 1]",
      isActive: true,
      mustChangePassword: true,
      profileCompleted: false,
      approvalStatus: null,
      approvedAt: null,
      approvedById: null,
      deletedAt: null,
    });

    const first = await prepareTestLabFixtures(ADMIN_ID);

    expect(first.prepared).toBe(true);
    expect(years).toHaveLength(1);
    expect(grades).toHaveLength(2);
    expect(sections).toHaveLength(2);
    // Two new auth users: the demo teacher and the pending teacher.
    expect(users).toHaveLength(3);
    expect(createUserMock).toHaveBeenCalledTimes(2);
    expect(learners.length).toBeGreaterThan(0);
    expect(enrollments).toHaveLength(learners.length);
    // Every learner's Enrollment points at the same grade/section/teacher as
    // the Learner row itself.
    for (const learner of learners) {
      const enrollment = enrollments.find((e) => e.learnerId === learner.id);
      expect(enrollment?.gradeLevelId).toBe(learner.gradeLevelId);
      expect(enrollment?.sectionId).toBe(learner.sectionId);
      expect(enrollment?.teacherId).toBe(learner.teacherId);
      expect(enrollment?.status).toBe("ACTIVE");
    }

    const head = users.find((u) => u.email === HEAD_EMAIL);
    expect(head?.profileCompleted).toBe(true);
    expect(head?.mustChangePassword).toBe(false);

    const counts = {
      years: years.length,
      grades: grades.length,
      sections: sections.length,
      users: users.length,
      learners: learners.length,
      enrollments: enrollments.length,
    };

    const second = await prepareTestLabFixtures(ADMIN_ID);

    expect(years).toHaveLength(counts.years);
    expect(grades).toHaveLength(counts.grades);
    expect(sections).toHaveLength(counts.sections);
    expect(users).toHaveLength(counts.users);
    expect(learners).toHaveLength(counts.learners);
    expect(enrollments).toHaveLength(counts.enrollments);
    expect(createUserMock).toHaveBeenCalledTimes(2); // no new auth users
    expect(second).toEqual(first);
  });
});

describe("findTestLabFixtures", () => {
  it("reports not prepared when there is no demo school", async () => {
    findDemoSchoolsMock.mockResolvedValue([]);
    const result = await findTestLabFixtures();
    expect(result.prepared).toBe(false);
    expect(result.schoolId).toBeNull();
  });

  it("reports prepared once prepareTestLabFixtures has run", async () => {
    seedLiveDemoSchool();
    await prepareTestLabFixtures(ADMIN_ID);

    const result = await findTestLabFixtures();
    expect(result.prepared).toBe(true);
    expect(result.schoolId).toBe(SCHOOL_ID);
    expect(result.teacherId).not.toBeNull();
    expect(result.learnerIds.length).toBeGreaterThan(0);
  });
});

describe("prepareTestLab action", () => {
  it("refuses a non-Super-Admin caller before any read", async () => {
    requireUserMock.mockImplementation(async () => {
      redirect("/school-head");
    });

    await expect(prepareTestLab()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });

    expect(findDemoSchoolsMock).not.toHaveBeenCalled();
    expect(writeAuditMock).not.toHaveBeenCalled();
  });

  it("asks for SUPER_ADMIN, then prepares fixtures and revalidates", async () => {
    seedLiveDemoSchool();
    requireUserMock.mockResolvedValue({ id: ADMIN_ID, role: "SUPER_ADMIN" });

    const result = await prepareTestLab();

    expect(requireUserMock).toHaveBeenCalledWith("SUPER_ADMIN");
    expect(result).toMatchObject({ ok: true });
    expect(revalidatePathMock).toHaveBeenCalledWith("/admin/test-lab");
  });
});

describe("TEST_LAB_PREPARE audit metadata", () => {
  it("carries only ids and counts — no email, name, or password", async () => {
    seedLiveDemoSchool();
    await prepareTestLabFixtures(ADMIN_ID);

    expect(writeAuditMock).toHaveBeenCalledTimes(1);
    const entry = writeAuditMock.mock.calls[0][0] as {
      action: string;
      metadata: Record<string, unknown>;
    };
    expect(entry.action).toBe("TEST_LAB_PREPARE");

    const serialized = JSON.stringify(entry.metadata);
    expect(serialized).not.toContain("@");
    expect(serialized.toLowerCase()).not.toContain("password");
    expect(serialized).not.toContain("Test Lab Teacher");
    expect(serialized).not.toContain("Test Lab Pending Teacher");

    // Only ids/counts — every value is a string (an id) or a number (a count).
    for (const value of Object.values(entry.metadata)) {
      expect(["string", "number"]).toContain(typeof value);
    }
  });
});
