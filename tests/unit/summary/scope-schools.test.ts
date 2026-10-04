import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { DIVISION_SCHOOLS, divisionRaw } from "./raw-fixtures";

/**
 * T11 / invariants I6, I10: summary schools come from `resolveScopeSchools`,
 * which never returns a demo school to a district admin, follows
 * `demoSchoolFilter` for the division, and is the only source of the schools
 * every facet's raw rows are fenced to.
 *
 * Every scope is now cut in memory from ONE cached list of live schools; the
 * cut must equal what `scopeSchoolWhere` selects in the database.
 */

const schoolFindMany = vi.fn();
const queryRaw = vi.fn();
const executeRaw = vi.fn();
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
    get $executeRaw() {
      return executeRaw;
    },
    $transaction: (fn: (tx: { $queryRaw: typeof queryRaw; $executeRaw: typeof executeRaw }) => unknown) =>
      fn({ $queryRaw: queryRaw, $executeRaw: executeRaw }),
  },
}));

type CacheOptions = { keyParts: string[]; tags: string[] };
const cachedQuery = vi.fn((fn: () => Promise<unknown>, _opts: CacheOptions) => fn());
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => Promise<unknown>, opts: CacheOptions) => cachedQuery(fn, opts),
}));

const isDemoVisible = vi.fn(async () => false);
vi.mock("@/lib/demo/session", () => ({ isDemoVisible: () => isDemoVisible() }));

const { resolveScopeSchools, scopeSchoolWhere, schoolsForScope, schoolsForAdminScope } = await import(
  "@/lib/summary/scope-schools"
);
const { schoolWhereForScope } = await import("@/lib/auth/admin-scope");
const { SUMMARY_FACETS } = await import("@/lib/summary/facets");

type AdminScope = import("@/lib/auth/admin-scope").AdminScope;
type SummaryScope = import("@/lib/auth/admin-scope").SummaryScope;

const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id);

beforeEach(() => {
  vi.clearAllMocks();
  schoolFindMany.mockResolvedValue(DIVISION_SCHOOLS);
  queryRaw.mockResolvedValue([]);
});

describe("resolveScopeSchools (T11)", () => {
  it("excludes demo schools for a district scope, even in a demo session", async () => {
    const got = await resolveScopeSchools({ kind: "districts", districts: ["Alabel 1"] }, true);
    expect(ids(got)).toEqual(["sch-alabel-ces", "sch-bagacay"]);
  });

  it("keeps only the district admin's own districts", async () => {
    const got = await resolveScopeSchools({ kind: "districts", districts: ["Alabel 1", "Glan 1"] }, false);
    expect(ids(got)).toEqual(["sch-alabel-ces", "sch-bagacay", "sch-glan-ces", "sch-gumasa"]);
  });

  it("follows demoSchoolFilter for the division", async () => {
    expect(ids(await resolveScopeSchools({ kind: "division" }, false))).not.toContain("sch-demo");
    expect(ids(await resolveScopeSchools({ kind: "all" }, false))).not.toContain("sch-demo");
    expect(ids(await resolveScopeSchools({ kind: "all" }, true))).toContain("sch-demo");
    // Inactive and no-district schools are part of the division.
    expect(ids(await resolveScopeSchools({ kind: "all" }, false))).toEqual([
      "sch-alabel-ces",
      "sch-bagacay",
      "sch-glan-ces",
      "sch-gumasa",
      "sch-nodistrict",
    ]);
  });

  it("pins a school scope to its id, live and demo-filtered", async () => {
    expect(scopeSchoolWhere({ kind: "school", schoolId: "s-1" }, false)).toEqual({
      AND: [{ id: "s-1" }, { deletedAt: null, isDemo: false }],
    });
    expect(ids(await resolveScopeSchools({ kind: "school", schoolId: "sch-gumasa" }, false))).toEqual(["sch-gumasa"]);
    expect(await resolveScopeSchools({ kind: "school", schoolId: "sch-demo" }, false)).toEqual([]);
    expect(ids(await resolveScopeSchools({ kind: "school", schoolId: "sch-demo" }, true))).toEqual(["sch-demo"]);
  });

  it("fails closed for a district admin with no districts", async () => {
    expect(await resolveScopeSchools({ kind: "districts", districts: [] }, false)).toEqual([]);
  });

  it("reads one live-school list for every scope, never a per-scope WHERE", async () => {
    await resolveScopeSchools({ kind: "all" }, true);
    await resolveScopeSchools({ kind: "districts", districts: ["Glan 1"] }, false);
    await resolveScopeSchools({ kind: "school", schoolId: "sch-gumasa" }, false);
    for (const [args] of schoolFindMany.mock.calls) {
      expect(args.where).toEqual({ deletedAt: null });
      expect(args.select).toMatchObject({ isDemo: true, isActive: true, district: true });
    }
    const keys = new Set(cachedQuery.mock.calls.map(([, o]) => JSON.stringify(o.keyParts)));
    expect(keys.size).toBe(1);
    expect(cachedQuery.mock.calls[0]![1].tags).toEqual(["schools-list", "division-summary"]);
  });

  it("returns ScopeSchool rows without the demo flag", async () => {
    const [first] = await resolveScopeSchools({ kind: "all" }, false);
    expect(Object.keys(first!).sort()).toEqual(
      ["district", "division", "id", "isActive", "name", "region", "schoolIdCode"].sort()
    );
  });
});

/**
 * A minimal evaluator for the `School` WHERE shapes `scopeSchoolWhere` and
 * `schoolWhereForScope` build: field equality, `{ in: [...] }`, and `AND`.
 * Throws on anything else, so a new WHERE shape fails this test loudly.
 */
type Row = Record<string, unknown>;
function matches(where: Prisma.SchoolWhereInput, row: Row): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "AND") return (v as Prisma.SchoolWhereInput[]).every((w) => matches(w, row));
    if (v !== null && typeof v === "object") {
      const keys = Object.keys(v);
      if (keys.length !== 1 || keys[0] !== "in") throw new Error(`unsupported filter on ${k}`);
      return (v as { in: unknown[] }).in.includes(row[k]);
    }
    return row[k] === v;
  });
}

/** The "table": live schools, a deleted one, and a district spelled in another case. */
const TABLE: Row[] = [
  ...DIVISION_SCHOOLS.map((s) => ({ ...s, deletedAt: null })),
  { id: "sch-gone", name: "Gone ES", schoolIdCode: "1", district: "Glan 1", division: null, region: null, isActive: true, isDemo: false, deletedAt: new Date() },
  { id: "sch-case", name: "Lowercase ES", schoolIdCode: "2", district: "glan 1", division: null, region: null, isActive: true, isDemo: false, deletedAt: null },
].sort((a, b) => String(a.name).localeCompare(String(b.name)));

const LIVE = TABLE.filter((r) => r.deletedAt === null) as unknown as typeof DIVISION_SCHOOLS;

const SCOPES: (AdminScope | SummaryScope)[] = [
  { kind: "division" },
  { kind: "all" },
  { kind: "districts", districts: ["Alabel 1"] },
  { kind: "districts", districts: ["Glan 1"] },
  { kind: "districts", districts: ["Alabel 1", "Glan 1"] },
  { kind: "districts", districts: [] },
  { kind: "school", schoolId: "sch-glan-ces" },
  { kind: "school", schoolId: "sch-demo" },
  { kind: "school", schoolId: "sch-gone" },
  { kind: "school", schoolId: "sch-nope" },
];

describe("the in-memory cut equals the database WHERE", () => {
  it.each(SCOPES.flatMap((s) => [[JSON.stringify(s), s, false] as const, [JSON.stringify(s), s, true] as const]))(
    "schoolsForScope %s (demo %s) = scopeSchoolWhere",
    (_name, scope, demo) => {
      const db = TABLE.filter((r) => matches(scopeSchoolWhere(scope, demo), r));
      expect(ids(schoolsForScope(LIVE, scope, demo))).toEqual(ids(db as { id: string }[]));
    }
  );

  it.each(SCOPES.filter((s): s is AdminScope => s.kind === "division" || s.kind === "districts").map((s) => [JSON.stringify(s), s] as const))(
    "schoolsForAdminScope %s = schoolWhereForScope (what loadSchoolInScope reads)",
    (_name, scope) => {
      const db = TABLE.filter((r) => matches(schoolWhereForScope(scope), r));
      expect(ids(schoolsForAdminScope(LIVE, scope))).toEqual(ids(db as { id: string }[]));
    }
  );
});

describe("facet raw rows are division-wide and fenced to the scope's schools", () => {
  /** Every array of school ids bound into the SQL (the old `ANY(ids)` fence). */
  function boundIdArrays(): string[][] {
    return queryRaw.mock.calls.flatMap(([sql]) =>
      (sql as { values: unknown[] }).values.filter(
        (v): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string") && v.some((x) => x.startsWith("sch-"))
      )
    );
  }

  it.each(Object.keys(SUMMARY_FACETS))("%s binds no school ids and shows only in-scope schools", async (id) => {
    const facetId = id as keyof typeof SUMMARY_FACETS;
    queryRaw.mockResolvedValue(divisionRaw(facetId));
    const result = await SUMMARY_FACETS[facetId].load(
      { kind: "districts", districts: ["Glan 1"] },
      { level: "school", from: "2026-09", to: "2026-09" }
    );

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(boundIdArrays()).toEqual([]);
    const shown = new Set(result.sections.flatMap((s) => s.table.groups.map((g) => g.schoolId)).filter(Boolean));
    expect([...shown].sort()).toEqual(["sch-glan-ces", "sch-gumasa"]);
    expect(result.schoolCount).toBe(2);
  });

  it("runs no query at all when the scope has no schools", async () => {
    for (const facet of Object.values(SUMMARY_FACETS)) {
      await facet.load({ kind: "districts", districts: [] }, {});
    }
    expect(queryRaw).not.toHaveBeenCalled();
  });
});
