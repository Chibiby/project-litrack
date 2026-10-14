import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const learnerCount = vi.fn();
const learnerFindMany = vi.fn();
const schoolFindMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: { count: learnerCount, findMany: learnerFindMany },
    school: { findMany: schoolFindMany },
  },
}));

const { getDeletedLearners, deletedLearnersWhere } = await import("@/lib/learners/deleted-learners");

const districtScope = { kind: "districts", districts: ["North"] } as const;

beforeEach(() => {
  vi.clearAllMocks();
  learnerCount.mockResolvedValue(0);
  learnerFindMany.mockResolvedValue([]);
  schoolFindMany.mockResolvedValue([]);
});

describe("deletedLearnersWhere", () => {
  it("requires deletedAt not null and puts the district scope on the school", () => {
    const where = deletedLearnersWhere({ scope: districtScope });
    expect(where.OR).toContainEqual({ deletedAt: { not: null } });
    expect(where.school).toEqual({
      AND: [{ deletedAt: null, isDemo: false, district: { in: ["North"] } }, { deletedAt: null }],
    });
  });

  describe("expired but not yet soft-deleted", () => {
    afterEach(() => vi.useRealTimers());

    it("adds an expiry branch once a cutoff exists, scope still ANDed alongside", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-12-01T00:00:00.000Z"));
      const where = deletedLearnersWhere({ scope: districtScope });
      expect(where.OR).toEqual([
        { deletedAt: { not: null } },
        { deletedAt: null, archivedAt: { not: null, lt: new Date("2026-11-01T00:00:00.000Z") } },
      ]);
      expect(JSON.stringify(where.school)).toContain("North");
    });

    it("has no expiry branch before the first expiry is possible", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-20T00:00:00.000Z"));
      const where = deletedLearnersWhere({ scope: districtScope });
      expect(where.OR).toEqual([{ deletedAt: { not: null } }]);
    });
  });

  it("a division scope has no district filter", () => {
    const where = deletedLearnersWhere({ scope: { kind: "division" } });
    expect(JSON.stringify(where)).not.toContain("district");
  });

  it("a school filter narrows alongside the scope and never replaces it", () => {
    const where = deletedLearnersWhere({ scope: districtScope, schoolId: "s-9", q: "ana" });
    expect(where.schoolId).toBe("s-9");
    expect(where.school).toBeDefined();
    expect(where.fullName).toEqual({ contains: "ana", mode: "insensitive" });
  });
});

describe("getDeletedLearners", () => {
  it("reads rows, the total and the in-scope school list with the same scope", async () => {
    await getDeletedLearners({ scope: districtScope, page: 2 });

    const countWhere = learnerCount.mock.calls[0][0].where;
    const findArgs = learnerFindMany.mock.calls[0][0];
    expect(findArgs.where).toEqual(countWhere);
    expect(findArgs.where.OR).toContainEqual({ deletedAt: { not: null } });
    expect(JSON.stringify(findArgs.where.school)).toContain("North");
    expect(findArgs.skip).toBe(50);
    expect(findArgs.take).toBe(50);
    expect(schoolFindMany.mock.calls[0][0].where).toEqual({
      deletedAt: null,
      isDemo: false,
      district: { in: ["North"] },
    });
  });

  it("an unknown sort falls back to recent, with an id tiebreaker", async () => {
    await getDeletedLearners({ scope: { kind: "division" }, sort: "bogus" });
    expect(learnerFindMany.mock.calls[0][0].orderBy).toEqual([{ deletedAt: "desc" }, { id: "asc" }]);
  });

  it("maps rows to the display shape", async () => {
    learnerCount.mockResolvedValue(51);
    learnerFindMany.mockResolvedValue([
      {
        id: "l-1",
        firstName: "Ana",
        middleName: null,
        lastName: "Reyes",
        archivedAt: new Date("2026-08-01T00:00:00.000Z"),
        deletedAt: new Date("2026-08-31T00:00:00.000Z"),
        gradeLevel: { type: "GRADE_3" },
        section: { name: "Sampaguita" },
        school: { id: "s-1", name: "North ES", district: "North" },
      },
    ]);

    const res = await getDeletedLearners({ scope: districtScope });

    expect(res.total).toBe(51);
    expect(res.pages).toBe(2);
    expect(res.rows[0]).toMatchObject({
      id: "l-1",
      sectionName: "Sampaguita",
      schoolId: "s-1",
      schoolName: "North ES",
      district: "North",
      removedAt: "2026-08-01T00:00:00.000Z",
      deletedAt: "2026-08-31T00:00:00.000Z",
    });
    expect(res.rows[0].name).toContain("Reyes");
  });

  it("shows the expiry date for an expired row the nightly job has not deleted yet", async () => {
    learnerFindMany.mockResolvedValue([
      {
        id: "l-2",
        firstName: "Ben",
        middleName: null,
        lastName: "Cruz",
        archivedAt: new Date("2026-10-20T00:00:00.000Z"),
        deletedAt: null,
        gradeLevel: { type: "GRADE_3" },
        section: null,
        school: { id: "s-1", name: "North ES", district: "North" },
      },
    ]);

    const res = await getDeletedLearners({ scope: districtScope });

    expect(res.rows[0].deletedAt).toBe("2026-11-19T00:00:00.000Z");
  });
});
