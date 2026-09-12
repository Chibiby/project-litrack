import { beforeEach, describe, expect, it, vi } from "vitest";

const SCHOOL_ID = "school-malandag";

const findManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    section: {
      findMany: (...a: unknown[]) => findManyMock(...a),
    },
  },
}));

// `cachedQuery` calls `unstable_cache(fn, keyParts, opts)()`. Returning `fn`
// unwrapped runs the read every time while still evaluating `keyParts`.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
}));

const { getAdviserlessSections } = await import("@/lib/teachers/adviserless");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAdviserlessSections", () => {
  it("queries for this school's live, adviser-free sections with live learners", async () => {
    findManyMock.mockResolvedValue([]);

    await getAdviserlessSections(SCHOOL_ID);

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const call = findManyMock.mock.calls[0][0];
    expect(call.where).toMatchObject({
      schoolId: SCHOOL_ID,
      deletedAt: null,
      adviserId: null,
      learners: { some: { deletedAt: null } },
    });
  });

  it("maps and orders sections by grade label then section name", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "sec-3-atis",
        name: "Atis",
        gradeLevel: { type: "G3" },
        _count: { learners: 12 },
      },
      {
        id: "sec-4-kalachuchi",
        name: "Kalachuchi",
        gradeLevel: { type: "G4" },
        _count: { learners: 5 },
      },
    ]);

    const result = await getAdviserlessSections(SCHOOL_ID);

    expect(result).toEqual([
      { id: "sec-3-atis", gradeLabel: "Grade 3", sectionName: "Atis", learnerCount: 12 },
      { id: "sec-4-kalachuchi", gradeLabel: "Grade 4", sectionName: "Kalachuchi", learnerCount: 5 },
    ]);
  });

  it("never queries another school's sections", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "sec-other-school",
        name: "Guyabano",
        gradeLevel: { type: "G1" },
        _count: { learners: 3 },
      },
    ]);

    await getAdviserlessSections(SCHOOL_ID);

    const call = findManyMock.mock.calls[0][0];
    expect(call.where.schoolId).toBe(SCHOOL_ID);
  });
});
