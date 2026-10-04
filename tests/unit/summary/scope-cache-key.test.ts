import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T10 / invariant I9: a cached summary is never served to a different scope.
 *
 * Nothing scope-specific is cached any more: a facet's only entries are the
 * division-wide raw rows and the division school list, shared by every scope,
 * and each request fences and shapes them for its own scope (`scopeRaw`; the
 * fence and leak tests are in scoped-raw.test.ts). So these tests hold that
 * every scope reads the SAME entries (no scope or demo flag in any key, hence
 * no per-scope result that could be served to another scope), and that a
 * school scope's raw read checks that school's dashboard tag. The test
 * iterates the registry, so a facet added to `facets.ts` is covered with no
 * edit here.
 */

const schoolFindMany = vi.fn();
const queryRaw = vi.fn();
const executeRaw = vi.fn();
// `queryLearnerRows` wraps its query in `prisma.$transaction` to scope a
// `SET LOCAL work_mem` bump to just that statement; the mock's `tx` exposes
// the same `$queryRaw`/`$executeRaw` stubs so callers don't need to branch.
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
const cachedQuery = vi.fn(async (fn: () => Promise<unknown>, _opts: CacheOptions) => fn());
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => Promise<unknown>, opts: CacheOptions) => cachedQuery(fn, opts),
}));

const isDemoVisible = vi.fn(async () => false);
vi.mock("@/lib/demo/session", () => ({ isDemoVisible: () => isDemoVisible() }));

const { SUMMARY_FACETS } = await import("@/lib/summary/facets");
const { scopeCacheKey } = await import("@/lib/auth/admin-scope");
type SummaryScope = import("@/lib/auth/admin-scope").SummaryScope;

const SCHOOLS = [
  { id: "s1", name: "Alabel CES", schoolIdCode: "130001", district: "Alabel 1", division: "Sarangani", region: "XII", isActive: true },
];

const SCOPES: SummaryScope[] = [
  { kind: "all" },
  { kind: "districts", districts: ["Alabel 1"] },
  { kind: "districts", districts: ["Alabel 1", "Alabel 2"] },
  { kind: "districts", districts: ["Glan 1"] },
  { kind: "school", schoolId: "s1" },
  { kind: "school", schoolId: "s2" },
];

beforeEach(() => {
  vi.clearAllMocks();
  schoolFindMany.mockResolvedValue(SCHOOLS);
  queryRaw.mockResolvedValue([]);
  isDemoVisible.mockResolvedValue(false);
});

/** The options of the facet's raw cache entry (not the scope-schools one). */
function rawCacheOptions(): CacheOptions {
  const call = cachedQuery.mock.calls.find(([, opts]) => opts.keyParts[0] === "summary-raw");
  if (!call) throw new Error("the facet load did not go through cachedQuery");
  return call[1];
}

/** Every key the last load(s) used. */
function allKeys(): string[] {
  return [...new Set(cachedQuery.mock.calls.map(([, o]) => JSON.stringify(o.keyParts)))].sort();
}

describe("scopeCacheKey", () => {
  it("separates district sets, orders, demo, and schools", () => {
    expect(scopeCacheKey({ kind: "districts", districts: ["B", "A"] }, false)).toBe(
      scopeCacheKey({ kind: "districts", districts: ["A", "B"] }, false)
    );
    expect(scopeCacheKey({ kind: "districts", districts: ["A"] }, false)).not.toBe(
      scopeCacheKey({ kind: "districts", districts: ["B"] }, false)
    );
    expect(scopeCacheKey({ kind: "all" }, true)).not.toBe(scopeCacheKey({ kind: "all" }, false));
    expect(scopeCacheKey({ kind: "school", schoolId: "s1" }, false)).toContain("s1");
  });
});

describe.each(Object.values(SUMMARY_FACETS).map((f) => [f.id, f] as const))(
  "facet %s cache key",
  (_id, facet) => {
    // Scopes with at least one school read the raw entry (a scope with none reads nothing).
    const READING = SCOPES.filter(
      (s) => s.kind === "all" || (s.kind === "districts" && s.districts.includes("Alabel 1")) || (s.kind === "school" && s.schoolId === "s1")
    );

    it.each(READING.flatMap((scope) => [[scope, false] as const, [scope, true] as const]))(
      "the raw entry for %j (demo %s) carries no scope or demo flag, and the right tags",
      async (scope, demo) => {
        isDemoVisible.mockResolvedValue(demo);
        await facet.load(scope, {});
        const opts = rawCacheOptions();
        for (const s of SCOPES) {
          for (const d of [false, true]) expect(opts.keyParts).not.toContain(scopeCacheKey(s, d));
        }
        expect(opts.tags).toContain("division-summary");
        if (scope.kind === "school") expect(opts.tags).toContain(`school-dashboard:${scope.schoolId}`);
        else expect(opts.tags).toEqual(["division-summary"]);
      }
    );

    it("every scope and demo flag reads the same, shared entries (nothing per scope is cached)", async () => {
      const seen = new Set<string>();
      for (const scope of READING) {
        for (const demo of [false, true]) {
          cachedQuery.mockClear();
          isDemoVisible.mockResolvedValue(demo);
          await facet.load(scope, {});
          seen.add(JSON.stringify(allKeys()));
        }
      }
      expect(seen.size).toBe(1);
      const [keys] = [...seen].map((k) => JSON.parse(k) as string[]);
      expect(keys!.map((k) => (JSON.parse(k) as string[])[0]).sort()).toEqual([
        "summary-raw",
        "summary-scope-schools",
      ]);
    });
  }
);
