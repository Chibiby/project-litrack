import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/lib/admin/school-detail.ts` — the server-side "Sort by" for the
 * (paginated) learners roster, and the surname-first `listingName` display
 * field shared by both rosters. The teachers roster is unpaginated and
 * sorted client-side in `school-detail-view.tsx`; its comparator is covered
 * by `school-detail-view-sort.test.tsx`.
 */

const SCHOOL_ID = "school-1";
const SCHOOL_ROW = {
  id: SCHOOL_ID,
  name: "Naidas T. Opong ES",
  schoolIdCode: "130554",
  address: null,
  region: null,
  division: null,
  district: null,
  isActive: true,
  isDemo: false,
  createdAt: new Date("2024-01-01T00:00:00Z"),
};

function baseLearner(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "learner-1",
    fullName: "Juan Dela Cruz",
    firstName: "Juan",
    middleName: null,
    lastName: "Dela Cruz",
    isAralLearner: false,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    gradeLevel: { type: "G1" },
    section: { name: "Sampaguita" },
    ...overrides,
  };
}

function baseTeacher(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "teacher-1",
    fullName: "Juana Cruz",
    firstName: "Juana",
    middleName: null,
    lastName: "Cruz",
    email: "juana@school.local",
    isActive: true,
    approvalStatus: null,
    createdAt: new Date("2024-01-01T00:00:00Z"),
    advisorySections: [],
    ...overrides,
  };
}

const prismaMock = {
  school: { findFirst: vi.fn(async () => SCHOOL_ROW) },
  user: { findMany: vi.fn(async () => [baseTeacher()]) },
  learner: {
    count: vi.fn(async () => 1),
    findMany: vi.fn(async () => [baseLearner()]),
  },
  section: { count: vi.fn(async () => 1) },
  gradeLevel: { count: vi.fn(async () => 1) },
  schoolYear: { count: vi.fn(async () => 1) },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const { SCHOOL_LEARNER_SORTS, schoolLearnerOrderBy, getSchoolDetail } = await import(
  "@/lib/admin/school-detail"
);

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.school.findFirst.mockResolvedValue(SCHOOL_ROW);
  prismaMock.user.findMany.mockResolvedValue([baseTeacher()]);
  prismaMock.learner.count.mockResolvedValue(1);
  prismaMock.learner.findMany.mockResolvedValue([baseLearner()]);
  prismaMock.section.count.mockResolvedValue(1);
  prismaMock.gradeLevel.count.mockResolvedValue(1);
  prismaMock.schoolYear.count.mockResolvedValue(1);
});

describe("SCHOOL_LEARNER_SORTS.parse", () => {
  it("accepts each allow-listed value", () => {
    for (const option of SCHOOL_LEARNER_SORTS.options) {
      expect(SCHOOL_LEARNER_SORTS.parse(option.value)).toBe(option.value);
    }
  });

  it("falls back to alphabetical for garbage/undefined", () => {
    expect(SCHOOL_LEARNER_SORTS.parse("not-a-real-sort")).toBe("alphabetical");
    expect(SCHOOL_LEARNER_SORTS.parse(undefined)).toBe("alphabetical");
  });
});

describe("schoolLearnerOrderBy — exhaustiveness and tiebreaker", () => {
  it("returns a non-empty orderBy array for every option, ending in the id tiebreaker", () => {
    for (const option of SCHOOL_LEARNER_SORTS.options) {
      const orderBy = schoolLearnerOrderBy(option.value);
      expect(orderBy.length).toBeGreaterThan(0);
      expect(orderBy[orderBy.length - 1]).toEqual({ id: "asc" });
    }
  });

  it("alphabetical orders by lastName then firstName, not fullName", () => {
    const orderBy = schoolLearnerOrderBy("alphabetical");
    expect(orderBy[0]).toEqual({ lastName: "asc" });
    expect(orderBy[1]).toEqual({ firstName: "asc" });
    expect(orderBy).not.toContainEqual({ fullName: "asc" });
  });

  it("grade-level and section tiebreak on name before id", () => {
    expect(schoolLearnerOrderBy("grade-level").slice(0, 3)).toEqual([
      { gradeLevel: { type: "asc" } },
      { lastName: "asc" },
      { firstName: "asc" },
    ]);
    expect(schoolLearnerOrderBy("section").slice(0, 3)).toEqual([
      { section: { name: "asc" } },
      { lastName: "asc" },
      { firstName: "asc" },
    ]);
  });

  it("date-added orders newest first", () => {
    expect(schoolLearnerOrderBy("date-added")[0]).toEqual({ createdAt: "desc" });
  });
});

describe("getSchoolDetail — learners orderBy wiring", () => {
  it("passes the parsed sort's orderBy to learner.findMany", async () => {
    await getSchoolDetail(SCHOOL_ID, 1, "grade-level");
    expect(prismaMock.learner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: schoolLearnerOrderBy("grade-level") })
    );
  });

  it("defaults to the alphabetical orderBy when no sort is given", async () => {
    await getSchoolDetail(SCHOOL_ID, 1);
    expect(prismaMock.learner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: schoolLearnerOrderBy("alphabetical") })
    );
  });

  it("falls back to alphabetical for a garbage sort value", async () => {
    await getSchoolDetail(SCHOOL_ID, 1, "not-a-real-sort");
    expect(prismaMock.learner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: schoolLearnerOrderBy("alphabetical") })
    );
  });

  it("sorting changes order only: where/skip/take are unaffected by sort", async () => {
    // `vi.fn()` here is untyped, so its recorded calls come back as an empty
    // tuple. Narrow to just the three fields this test reads.
    type FindManyArgs = { where: unknown; skip: unknown; take: unknown };
    const callArgs = (): FindManyArgs =>
      (prismaMock.learner.findMany.mock.calls as unknown as FindManyArgs[][])[0]![0];

    await getSchoolDetail(SCHOOL_ID, 2, "alphabetical");
    const alphaCall = callArgs();
    prismaMock.learner.findMany.mockClear();

    await getSchoolDetail(SCHOOL_ID, 2, "grade-level");
    const gradeCall = callArgs();

    expect(gradeCall.where).toEqual(alphaCall.where);
    expect(gradeCall.skip).toEqual(alphaCall.skip);
    expect(gradeCall.take).toEqual(alphaCall.take);
  });
});

describe("getSchoolDetail — tenancy", () => {
  it("scopes both the teacher and learner queries to schoolId", async () => {
    await getSchoolDetail(SCHOOL_ID, 1, "section");
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ schoolId: SCHOOL_ID }) })
    );
    expect(prismaMock.learner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ schoolId: SCHOOL_ID }) })
    );
    expect(prismaMock.learner.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ schoolId: SCHOOL_ID }) })
    );
  });
});

describe("getSchoolDetail — listingName", () => {
  it("teacher row: surname-first with no middle name", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseTeacher({ firstName: "Juana", middleName: null, lastName: "Cruz" }),
    ]);
    const detail = await getSchoolDetail(SCHOOL_ID, 1);
    expect(detail?.teachers[0].listingName).toBe("Cruz, Juana");
    expect(detail?.teachers[0].fullName).toBe("Juana Cruz");
  });

  it("teacher row: falls back to the given name with no leading comma for a blank surname", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseTeacher({ firstName: "Juana", middleName: null, lastName: "" }),
    ]);
    const detail = await getSchoolDetail(SCHOOL_ID, 1);
    expect(detail?.teachers[0].listingName).toBe("Juana");
  });

  it("learner row: surname-first with a middle name", async () => {
    prismaMock.learner.findMany.mockResolvedValueOnce([
      baseLearner({ firstName: "Juan", middleName: "Reyes", lastName: "Dela Cruz" }),
    ]);
    const detail = await getSchoolDetail(SCHOOL_ID, 1);
    expect(detail?.learners[0].listingName).toBe("Dela Cruz, Juan Reyes");
    expect(detail?.learners[0].fullName).toBe("Juan Dela Cruz");
  });

  it("learner row: falls back to the given name with no leading comma for a blank surname", async () => {
    prismaMock.learner.findMany.mockResolvedValueOnce([
      baseLearner({ firstName: "Juan", middleName: null, lastName: "" }),
    ]);
    const detail = await getSchoolDetail(SCHOOL_ID, 1);
    expect(detail?.learners[0].listingName).toBe("Juan");
  });
});
