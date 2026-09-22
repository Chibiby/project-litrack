import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/lib/admin/archive.ts` — "Sort by" registries for the two independently
 * sortable Archive buckets (removed teachers, removed learners), their
 * orderBy mappers, and the surname-first `listingName` display field.
 */

const SCHOOL = { id: "school-1", name: "Naidas T. Opong ES", deletedAt: null };

function baseTeacher(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "teacher-1",
    fullName: "Juana Cruz",
    firstName: "Juana",
    middleName: null,
    lastName: "Cruz",
    email: "juana@school.local",
    deletedAt: new Date("2024-01-01T00:00:00Z"),
    school: SCHOOL,
    ...overrides,
  };
}

function baseLearner(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "learner-1",
    fullName: "Juan Dela Cruz",
    firstName: "Juan",
    middleName: null,
    lastName: "Dela Cruz",
    isAralLearner: false,
    deletedAt: new Date("2024-01-01T00:00:00Z"),
    gradeLevel: { type: "G1" },
    section: { name: "Sampaguita" },
    school: SCHOOL,
    ...overrides,
  };
}

const prismaMock = {
  user: {
    count: vi.fn(async () => 1),
    findMany: vi.fn(async () => [baseTeacher()]),
  },
  learner: {
    count: vi.fn(async () => 1),
    findMany: vi.fn(async () => [baseLearner()]),
  },
  enrollment: { groupBy: vi.fn(async () => []) },
  attendance: { groupBy: vi.fn(async () => []) },
  readingLevelRecord: { groupBy: vi.fn(async () => []) },
  termGrade: { groupBy: vi.fn(async () => []) },
  aralProfile: { groupBy: vi.fn(async () => []) },
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const {
  ARCHIVE_TEACHER_SORTS,
  ARCHIVE_LEARNER_SORTS,
  archiveTeacherOrderBy,
  archiveLearnerOrderBy,
  getArchive,
} = await import("@/lib/admin/archive");

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.count.mockResolvedValue(1);
  prismaMock.user.findMany.mockResolvedValue([baseTeacher()]);
  prismaMock.learner.count.mockResolvedValue(1);
  prismaMock.learner.findMany.mockResolvedValue([baseLearner()]);
  for (const model of [
    prismaMock.enrollment,
    prismaMock.attendance,
    prismaMock.readingLevelRecord,
    prismaMock.termGrade,
    prismaMock.aralProfile,
  ]) {
    model.groupBy.mockResolvedValue([]);
  }
});

describe("ARCHIVE_TEACHER_SORTS / ARCHIVE_LEARNER_SORTS .parse", () => {
  it("accepts each allow-listed value and falls back to 'recent' on garbage/undefined", () => {
    for (const sorts of [ARCHIVE_TEACHER_SORTS, ARCHIVE_LEARNER_SORTS]) {
      for (const option of sorts.options) {
        expect(sorts.parse(option.value)).toBe(option.value);
      }
      expect(sorts.parse("not-a-real-sort")).toBe("recent");
      expect(sorts.parse(undefined)).toBe("recent");
    }
  });
});

describe("archiveTeacherOrderBy / archiveLearnerOrderBy — exhaustiveness and tiebreaker", () => {
  it("returns a non-empty orderBy array for every option, ending in the id tiebreaker", () => {
    for (const option of ARCHIVE_TEACHER_SORTS.options) {
      const orderBy = archiveTeacherOrderBy(option.value);
      expect(orderBy.length).toBeGreaterThan(0);
      expect(orderBy[orderBy.length - 1]).toEqual({ id: "asc" });
    }
    for (const option of ARCHIVE_LEARNER_SORTS.options) {
      const orderBy = archiveLearnerOrderBy(option.value);
      expect(orderBy.length).toBeGreaterThan(0);
      expect(orderBy[orderBy.length - 1]).toEqual({ id: "asc" });
    }
  });

  it("alphabetical orders by lastName then firstName, not fullName", () => {
    expect(archiveTeacherOrderBy("alphabetical").slice(0, 2)).toEqual([
      { lastName: "asc" },
      { firstName: "asc" },
    ]);
    expect(archiveTeacherOrderBy("alphabetical")).not.toContainEqual({ fullName: "asc" });
    expect(archiveLearnerOrderBy("alphabetical").slice(0, 2)).toEqual([
      { lastName: "asc" },
      { firstName: "asc" },
    ]);
    expect(archiveLearnerOrderBy("alphabetical")).not.toContainEqual({ fullName: "asc" });
  });

  it("recent orders by deletedAt desc", () => {
    expect(archiveTeacherOrderBy("recent")[0]).toEqual({ deletedAt: "desc" });
    expect(archiveLearnerOrderBy("recent")[0]).toEqual({ deletedAt: "desc" });
  });

  it("school orders by the joined school name before tiebreaking on name", () => {
    expect(archiveTeacherOrderBy("school").slice(0, 3)).toEqual([
      { school: { name: "asc" } },
      { lastName: "asc" },
      { firstName: "asc" },
    ]);
    expect(archiveLearnerOrderBy("school").slice(0, 3)).toEqual([
      { school: { name: "asc" } },
      { lastName: "asc" },
      { firstName: "asc" },
    ]);
  });
});

describe("getArchive — the two buckets sort independently", () => {
  it("passes each bucket's own parsed orderBy to its own findMany call", async () => {
    await getArchive({ teachersSort: "alphabetical", learnersSort: "school" });

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: archiveTeacherOrderBy("alphabetical") })
    );
    expect(prismaMock.learner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: archiveLearnerOrderBy("school") })
    );
  });

  it("setting only teachersSort leaves the learners bucket on its own default", async () => {
    await getArchive({ teachersSort: "alphabetical" });

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: archiveTeacherOrderBy("alphabetical") })
    );
    expect(prismaMock.learner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: archiveLearnerOrderBy("recent") })
    );
  });

  it("setting only learnersSort leaves the teachers bucket on its own default", async () => {
    await getArchive({ learnersSort: "alphabetical" });

    expect(prismaMock.learner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: archiveLearnerOrderBy("alphabetical") })
    );
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: archiveTeacherOrderBy("recent") })
    );
  });

  it("defaults both buckets to recent when neither sort param is given", async () => {
    await getArchive({});

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: archiveTeacherOrderBy("recent") })
    );
    expect(prismaMock.learner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: archiveLearnerOrderBy("recent") })
    );
  });
});

describe("getArchive — listingName", () => {
  it("teacher row: surname-first with no middle name", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseTeacher({ firstName: "Juana", middleName: null, lastName: "Cruz" }),
    ]);
    const archive = await getArchive({});
    expect(archive.teachers.rows[0].listingName).toBe("Cruz, Juana");
    expect(archive.teachers.rows[0].fullName).toBe("Juana Cruz");
  });

  it("teacher row: falls back to the given name with no leading comma for a blank surname", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([
      baseTeacher({ firstName: "Juana", middleName: null, lastName: "" }),
    ]);
    const archive = await getArchive({});
    expect(archive.teachers.rows[0].listingName).toBe("Juana");
  });

  it("learner row: surname-first with a middle name", async () => {
    prismaMock.learner.findMany.mockResolvedValueOnce([
      baseLearner({ firstName: "Juan", middleName: "Reyes", lastName: "Dela Cruz" }),
    ]);
    const archive = await getArchive({});
    expect(archive.learners.rows[0].listingName).toBe("Dela Cruz, Juan Reyes");
    expect(archive.learners.rows[0].fullName).toBe("Juan Dela Cruz");
  });

  it("learner row: falls back to the given name with no leading comma for a blank surname", async () => {
    prismaMock.learner.findMany.mockResolvedValueOnce([
      baseLearner({ firstName: "Juan", middleName: null, lastName: "" }),
    ]);
    const archive = await getArchive({});
    expect(archive.learners.rows[0].listingName).toBe("Juan");
  });
});

describe("getArchive — tenancy scoping is unaffected by sort", () => {
  it("still narrows both buckets by school when ?school= is given, for every sort", async () => {
    await getArchive({ school: SCHOOL.id, teachersSort: "school", learnersSort: "school" });

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ schoolId: SCHOOL.id }) })
    );
    expect(prismaMock.learner.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ schoolId: SCHOOL.id }) })
    );
    expect(prismaMock.user.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ schoolId: SCHOOL.id }) })
    );
    expect(prismaMock.learner.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ schoolId: SCHOOL.id }) })
    );
  });
});
