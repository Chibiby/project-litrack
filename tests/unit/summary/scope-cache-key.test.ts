import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * T10 / invariant I9: a cached summary is never served to a different scope.
 *
 * Every facet's cache key must carry `scopeCacheKey(scope, demoVisible)`. The
 * test iterates the registry, so a facet added to `facets.ts` is covered with
 * no edit here.
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

/** The options of the facet's own cache entry (not the scope-schools one). */
function facetCacheOptions(): CacheOptions {
  const call = cachedQuery.mock.calls.find(([, opts]) => opts.keyParts[0] === "summary");
  if (!call) throw new Error("the facet load did not go through cachedQuery");
  return call[1];
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
    it.each(SCOPES.flatMap((scope) => [[scope, false] as const, [scope, true] as const]))(
      "carries scopeCacheKey for %j (demo %s)",
      async (scope, demo) => {
        isDemoVisible.mockResolvedValue(demo);
        await facet.load(scope, {});
        const opts = facetCacheOptions();
        expect(opts.keyParts).toContain(scopeCacheKey(scope, demo));
        expect(opts.tags).toContain("division-summary");
        if (scope.kind === "school") expect(opts.tags).toContain(`school-dashboard:${scope.schoolId}`);
      }
    );

    it("never shares a key between two different scopes", async () => {
      const keys = new Set<string>();
      for (const scope of SCOPES) {
        for (const demo of [false, true]) {
          cachedQuery.mockClear();
          isDemoVisible.mockResolvedValue(demo);
          await facet.load(scope, {});
          keys.add(JSON.stringify(facetCacheOptions().keyParts));
        }
      }
      // `all` with demo on/off, districts x3 x2, school x2 x2: every one distinct.
      expect(keys.size).toBe(SCOPES.length * 2);
    });
  }
);
