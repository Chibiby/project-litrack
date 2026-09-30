import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The legacy modules `learner`, `section` and `school-year` now run behind
 * `action()`. Three things are pinned here, because each used to behave
 * differently:
 *
 *   - An unexpected database failure (a P1001-shaped rejection) comes back as a
 *     classified `DB_UNAVAILABLE` whose message names what the person was doing
 *     ("Couldn't create the section: …") and carries a reference. It used to be
 *     either a generic "Failed to create section" or a thrown error.
 *   - A known condition (a taken name, a taken label) still says exactly that.
 *   - The learner duplicate warning is a `needs` flag with a readable sentence,
 *     not the string "possible_duplicate" smuggled through `error`.
 *
 * Only leaf infrastructure is mocked; the real Zod schemas run.
 */

const SCHOOL_ID = "school-1";
const USER_ID = "user-1";

/** What Prisma throws when the database cannot be reached. */
function prismaDown() {
  return Object.assign(new Error("Can't reach database server at `db:5432`"), {
    name: "PrismaClientKnownRequestError",
    code: "P1001",
  });
}

function uniqueViolation() {
  return Object.assign(new Error("Unique constraint failed on the fields: (`schoolId`,`label`)"), {
    name: "PrismaClientKnownRequestError",
    code: "P2002",
  });
}

const sectionFindFirst = vi.fn();
const sectionCreate = vi.fn();
const sectionUpdate = vi.fn();
const gradeFindFirst = vi.fn();
const schoolYearCreate = vi.fn();
const learnerFindMany = vi.fn();
const learnerFindFirst = vi.fn();
const schoolYearFindFirst = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transaction(...args),
    gradeLevel: { findFirst: (...args: unknown[]) => gradeFindFirst(...args) },
    section: {
      findFirst: (...args: unknown[]) => sectionFindFirst(...args),
      create: (...args: unknown[]) => sectionCreate(...args),
      update: (...args: unknown[]) => sectionUpdate(...args),
    },
    schoolYear: {
      create: (...args: unknown[]) => schoolYearCreate(...args),
      findFirst: (...args: unknown[]) => schoolYearFindFirst(...args),
    },
    learner: {
      findMany: (...args: unknown[]) => learnerFindMany(...args),
      findFirst: (...args: unknown[]) => learnerFindFirst(...args),
    },
  },
}));

const requireSchoolUser = vi.fn(async () => ({
  id: USER_ID,
  schoolId: SCHOOL_ID,
  role: "SCHOOL_HEAD" as const,
  profileCompleted: true,
}));
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...(args as [])),
}));

const writeAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [])),
  writeAuditMany: vi.fn(async () => {}),
  AUDIT_ACTIONS: new Proxy({}, { get: (_t, key) => String(key) }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: vi.fn(),
  revalidateSchoolDashboard: vi.fn(),
  revalidateSchoolHeadTeachers: vi.fn(),
  revalidateSchoolTeachers: vi.fn(),
  revalidateTeacherCaches: vi.fn(),
}));

const reportError = vi.fn(() => "E-TEST0001");
vi.mock("@/lib/errors/report", () => ({
  reportError: (...args: unknown[]) => reportError(...(args as [])),
}));

vi.mock("@/lib/teachers/advisory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/teachers/advisory")>()),
  getAdvisoryPlacements: vi.fn(async () => [
    {
      sectionId: "section-1",
      sectionName: "Sampaguita",
      gradeLevelId: "grade-4",
      gradeType: "GRADE_4",
      gradeLabel: "Grade 4",
      label: "Grade 4 · Sampaguita",
    },
  ]),
}));

const { createSection, updateSection, deleteSection } = await import(
  "@/lib/actions/section"
);
const { createSchoolYear } = await import("@/lib/actions/school-year");
const { createLearner, archiveLearner } = await import("@/lib/actions/learner");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  gradeFindFirst.mockResolvedValue({ id: "grade-4", schoolId: SCHOOL_ID });
});

describe("createSection", () => {
  it("names what failed and carries a reference when the database is unreachable", async () => {
    sectionFindFirst.mockRejectedValue(prismaDown());

    const res = await createSection(form({ gradeLevelId: "grade-4", name: "Rosal" }));

    expect(res).toMatchObject({ ok: false, code: "DB_UNAVAILABLE", ref: "E-TEST0001" });
    const error = (res as { error: string }).error;
    expect(error).toContain("Couldn't create the section");
    expect(error).not.toMatch(/Failed to create/);
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("still says the name is taken for a known duplicate", async () => {
    sectionFindFirst.mockResolvedValue({ id: "s-9", name: "Rosal", deletedAt: null });

    const res = await createSection(form({ gradeLevelId: "grade-4", name: "rosal" }));

    expect(res).toMatchObject({
      ok: false,
      code: "VALIDATION_FAILED",
      error: "A section with this name already exists in this grade",
      fieldErrors: { name: "A section with this name already exists in this grade" },
    });
    expect(reportError).not.toHaveBeenCalled();
    expect(sectionCreate).not.toHaveBeenCalled();
  });

  it("scopes the grade lookup to the caller's school", async () => {
    gradeFindFirst.mockResolvedValue(null);

    const res = await createSection(form({ gradeLevelId: "grade-x", name: "Rosal" }));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(gradeFindFirst.mock.calls[0][0].where).toMatchObject({ schoolId: SCHOOL_ID });
  });
});

describe("updateSection", () => {
  it("translates a unique-index race into the specific name-taken message", async () => {
    sectionFindFirst
      .mockResolvedValueOnce({ id: "s-1", gradeLevelId: "grade-4", schoolId: SCHOOL_ID })
      .mockResolvedValueOnce(null);
    sectionUpdate.mockRejectedValue(uniqueViolation());

    const res = await updateSection(form({ sectionId: "s-1", name: "Rosal" }));

    expect(res).toMatchObject({
      ok: false,
      error: "A section with this name already exists in this grade",
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  it("classifies any other write failure instead of saying 'Failed to update section'", async () => {
    sectionFindFirst
      .mockResolvedValueOnce({ id: "s-1", gradeLevelId: "grade-4", schoolId: SCHOOL_ID })
      .mockResolvedValueOnce(null);
    sectionUpdate.mockRejectedValue(prismaDown());

    const res = await updateSection(form({ sectionId: "s-1", name: "Rosal" }));

    expect(res).toMatchObject({ ok: false, code: "DB_UNAVAILABLE" });
    expect((res as { error: string }).error).toContain("Couldn't rename the section");
  });
});

describe("deleteSection", () => {
  it("reports an unreachable database through the classified message", async () => {
    sectionFindFirst.mockResolvedValue({ id: "s-1", gradeLevelId: "grade-4", name: "A" });
    transaction.mockRejectedValue(prismaDown());

    const res = await deleteSection(form({ sectionId: "s-1" }));

    expect(res).toMatchObject({ ok: false, code: "DB_UNAVAILABLE" });
    expect((res as { error: string }).error).toContain("Couldn't remove the section");
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("createSchoolYear", () => {
  const fields = {
    label: "2026-2027",
    startDate: "2026-06-08",
    endDate: "2027-03-31",
  };

  it("names what failed when the database is unreachable", async () => {
    transaction.mockRejectedValue(prismaDown());

    const res = await createSchoolYear(form(fields));

    expect(res).toMatchObject({ ok: false, code: "DB_UNAVAILABLE", ref: "E-TEST0001" });
    expect((res as { error: string }).error).toContain("Couldn't create the school year");
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("still says the label is taken on a unique violation", async () => {
    transaction.mockRejectedValue(uniqueViolation());

    const res = await createSchoolYear(form(fields));

    expect(res).toMatchObject({
      ok: false,
      error: "A school year with this label already exists",
    });
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("archiveLearner", () => {
  it("names what failed when the database is unreachable", async () => {
    learnerFindFirst.mockRejectedValue(prismaDown());

    const res = await archiveLearner(form({ id: "11111111-1111-4111-8111-111111111111" }));

    expect(res).toMatchObject({ ok: false, code: "DB_UNAVAILABLE" });
    expect((res as { error: string }).error).toContain("Couldn't archive the learner");
  });

  it("answers a learner from another school exactly like a missing one", async () => {
    learnerFindFirst.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      schoolId: "school-2",
    });

    const res = await archiveLearner(form({ id: "11111111-1111-4111-8111-111111111111" }));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(JSON.stringify(res)).not.toContain("school-2");
    expect(transaction).not.toHaveBeenCalled();
  });
});

describe("createLearner", () => {
  const fields = {
    gradeLevelId: "grade-4",
    firstName: "Ana",
    lastName: "Santos",
    age: "10",
    gender: "FEMALE",
    nutritionalStatus: "NORMAL",
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
    parentEducation: "SECONDARY_GRADUATE",
  };

  it("flags a possible duplicate with `needs`, not by overloading `error`", async () => {
    requireSchoolUser.mockResolvedValueOnce({
      id: USER_ID,
      schoolId: SCHOOL_ID,
      role: "TEACHER" as never,
      profileCompleted: true,
    } as never);
    learnerFindMany.mockResolvedValue([
      { id: "existing-1", firstName: "Ana", lastName: "Santos", fullName: "Ana Santos", age: 10 },
    ]);

    const res = await createLearner(form(fields));

    expect(res).toMatchObject({
      ok: false,
      needs: "possible_duplicate",
      data: { id: "existing-1" },
    });
    const error = (res as { error: string }).error;
    expect(error).not.toBe("possible_duplicate");
    expect(error).toMatch(/may already exist/);
    // The duplicate probe is tenant-scoped.
    expect(learnerFindMany.mock.calls[0][0].where).toMatchObject({
      schoolId: SCHOOL_ID,
      deletedAt: null,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("classifies a database failure while saving instead of throwing", async () => {
    requireSchoolUser.mockResolvedValueOnce({
      id: USER_ID,
      schoolId: SCHOOL_ID,
      role: "TEACHER" as never,
      profileCompleted: true,
    } as never);
    learnerFindMany.mockResolvedValue([]);
    schoolYearFindFirst.mockResolvedValue(null);
    transaction.mockRejectedValue(prismaDown());

    const res = await createLearner(form(fields));

    expect(res).toMatchObject({ ok: false, code: "DB_UNAVAILABLE" });
    expect((res as { error: string }).error).toContain("Couldn't add the learner");
  });
});
