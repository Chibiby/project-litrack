import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

/**
 * T11 / invariants I6, I10: summary schools come from `resolveScopeSchools`,
 * which never returns a demo school to a district admin, follows
 * `demoSchoolFilter` for the division, and is the only source of the ids every
 * facet query is fenced by.
 */

const schoolFindMany = vi.fn();
const queryRaw = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      get findMany() {
        return schoolFindMany;
      },
    },
    get $queryRaw() {
      return queryRaw;
    },
  },
}));

vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => Promise<unknown>) => fn(),
}));

const isDemoVisible = vi.fn(async () => false);
vi.mock("@/lib/demo/session", () => ({ isDemoVisible: () => isDemoVisible() }));

const { resolveScopeSchools, scopeSchoolWhere } = await import("@/lib/summary/scope-schools");
const { SUMMARY_FACETS } = await import("@/lib/summary/facets");

function whereOf(callIndex = 0): Prisma.SchoolWhereInput {
  return schoolFindMany.mock.calls[callIndex]![0].where;
}

const IN_SCOPE = [
  { id: "s-alabel-1", name: "Alabel CES", schoolIdCode: "1", district: "Alabel 1", division: null, region: null, isActive: true },
  { id: "s-alabel-2", name: "Bagacay ES", schoolIdCode: "2", district: "Alabel 2", division: null, region: null, isActive: false },
];

beforeEach(() => {
  vi.clearAllMocks();
  schoolFindMany.mockResolvedValue(IN_SCOPE);
  queryRaw.mockResolvedValue([]);
});

describe("resolveScopeSchools (T11)", () => {
  it("excludes demo schools for a district scope, even in a demo session", async () => {
    await resolveScopeSchools({ kind: "districts", districts: ["Alabel 1"] }, true);
    expect(whereOf()).toEqual({
      deletedAt: null,
      isDemo: false,
      district: { in: ["Alabel 1"] },
    });
  });

  it("puts the district filter in the WHERE for a district admin's own scope", async () => {
    await resolveScopeSchools({ kind: "districts", districts: ["Alabel 1", "Alabel 2"] }, false);
    expect(whereOf()).toMatchObject({ district: { in: ["Alabel 1", "Alabel 2"] }, isDemo: false });
  });

  it("follows demoSchoolFilter for the division", async () => {
    await resolveScopeSchools({ kind: "division" }, false);
    await resolveScopeSchools({ kind: "all" }, false);
    await resolveScopeSchools({ kind: "all" }, true);
    expect(whereOf(0)).toEqual({ deletedAt: null, isDemo: false });
    expect(whereOf(1)).toEqual({ deletedAt: null, isDemo: false });
    expect(whereOf(2)).toEqual({ deletedAt: null });
  });

  it("pins a school scope to its id, live and demo-filtered", () => {
    expect(scopeSchoolWhere({ kind: "school", schoolId: "s-1" }, false)).toEqual({
      AND: [{ id: "s-1" }, { deletedAt: null, isDemo: false }],
    });
  });

  it("fails closed for a district admin with no districts", async () => {
    await resolveScopeSchools({ kind: "districts", districts: [] }, false);
    expect(whereOf()).toMatchObject({ district: { in: [] } });
  });
});

describe("facet queries are fenced by the scope's school ids", () => {
  /** Every array bound into the SQL: the `ANY(${ids}::text[])` parameters. */
  function boundIdArrays(): string[][] {
    return queryRaw.mock.calls.flatMap(([sql]) =>
      (sql as { values: unknown[] }).values.filter((v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string") && v.some((x) => x.startsWith("s-")))
    );
  }

  it.each(Object.keys(SUMMARY_FACETS))("%s binds only the in-scope ids", async (id) => {
    const facet = SUMMARY_FACETS[id as keyof typeof SUMMARY_FACETS];
    await facet.load({ kind: "districts", districts: ["Alabel 1", "Alabel 2"] }, {});

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const arrays = boundIdArrays();
    expect(arrays.length).toBeGreaterThan(0);
    const expected =
      id === "compliance" ? ["s-alabel-1"] : ["s-alabel-1", "s-alabel-2"]; // compliance: active schools only
    for (const ids of arrays) expect(ids).toEqual(expected);
  });

  it("runs no query at all when the scope has no schools", async () => {
    schoolFindMany.mockResolvedValue([]);
    for (const facet of Object.values(SUMMARY_FACETS)) {
      await facet.load({ kind: "districts", districts: [] }, {});
    }
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
