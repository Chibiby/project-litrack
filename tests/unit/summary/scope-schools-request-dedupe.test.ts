import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `resolveScopeSchools`'s per-request dedupe (src/lib/summary/scope-schools.ts).
 *
 * `/district`'s overview calls `resolveScopeSchools` once directly and again
 * inside each of the four summary-facet loads — all with the same tenancy but
 * different `scope` object identities (an `AdminScope` from the page, a
 * `SummaryScope` `resolveSummaryScope` returns for the facets). The module
 * keys a single per-request `Map` on `scopeCacheKey(scope, demoVisible)`
 * rather than on `scope` itself so those calls collapse into one
 * `cachedQuery`/Postgres read; two DIFFERENT scopes (different tenancy) must
 * never share an entry — that would be a cross-tenant leak, not a speedup.
 *
 * React `cache()` only memoizes inside a render/request context that does not
 * exist in a unit test, so `react` is mocked here to a memo that is fresh
 * every time `cache()` itself is CALLED (i.e. every module evaluation), which
 * is what one request gives it in production. Each test therefore
 * `vi.resetModules()`s and re-imports the module under test, so the top-level
 * `const getRequestMemo = cache(() => new Map())` re-runs and starts a new,
 * empty `Map` — simulating a fresh request — while two calls WITHIN one test
 * still share that test's Map, exercising the dedupe the real code relies on.
 */

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <T,>(fn: () => T): (() => T) => {
      let called = false;
      let value: T;
      return () => {
        if (!called) {
          called = true;
          value = fn();
        }
        return value;
      };
    },
  };
});

const schoolFindMany = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      get findMany() {
        return schoolFindMany;
      },
    },
  },
}));

const cachedQueryImpl = vi.fn((fn: () => Promise<unknown>, _opts: unknown) => fn());
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => Promise<unknown>, opts: unknown) => cachedQueryImpl(fn, opts),
}));

const ROWS = [{ id: "s-1", name: "A", schoolIdCode: "1", district: "D1", division: null, region: null, isActive: true }];

let resolveScopeSchools: typeof import("@/lib/summary/scope-schools").resolveScopeSchools;

beforeEach(async () => {
  vi.clearAllMocks();
  schoolFindMany.mockResolvedValue(ROWS);
  vi.resetModules();
  ({ resolveScopeSchools } = await import("@/lib/summary/scope-schools"));
});

describe("resolveScopeSchools — per-request dedupe", () => {
  it("runs the underlying query once for two equal-but-different scope objects", async () => {
    const scopeA = { kind: "districts" as const, districts: ["Alabel 1"] };
    const scopeB = { kind: "districts" as const, districts: ["Alabel 1"] }; // same tenancy, different object

    await resolveScopeSchools(scopeA, false);
    await resolveScopeSchools(scopeB, false);

    expect(cachedQueryImpl).toHaveBeenCalledTimes(1);
    expect(schoolFindMany).toHaveBeenCalledTimes(1);
  });

  it("runs the underlying query twice for two genuinely different scopes", async () => {
    const scopeA = { kind: "districts" as const, districts: ["Alabel 1"] };
    const scopeB = { kind: "districts" as const, districts: ["Alabel 2"] };

    await resolveScopeSchools(scopeA, false);
    await resolveScopeSchools(scopeB, false);

    expect(cachedQueryImpl).toHaveBeenCalledTimes(2);
    expect(schoolFindMany).toHaveBeenCalledTimes(2);
  });

  it("treats a different demoVisible flag as a different scope, even with identical districts", async () => {
    const scope = { kind: "districts" as const, districts: ["Alabel 1"] };

    await resolveScopeSchools(scope, false);
    await resolveScopeSchools(scope, true);

    expect(cachedQueryImpl).toHaveBeenCalledTimes(2);
  });
});
