import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `getDistrictNotifications`'s per-request dedupe
 * (src/lib/district/notifications.ts).
 *
 * Called once from `layout.tsx` (the header bell) and again from the page's
 * `AttentionRail` in the same request, each holding its own `AdminScope`
 * object — even when the underlying assignments are identical they are not
 * the same object, so a `cache()`-wrapped function keyed on `scope` itself
 * would miss both times. The module instead keys a per-request `Map` on
 * `user.id` + `scopeCacheKey(scope, false)`.
 *
 * As in the scope-schools dedupe test, `react`'s `cache()` is mocked to a
 * memo that is fresh every time `cache()` is CALLED (i.e. every module
 * evaluation) — so each test `vi.resetModules()`s and re-imports the module
 * under test to get a fresh `Map`, simulating one request, while asserting
 * that two calls WITHIN that one simulated request collapse into one
 * underlying count.
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

const ticketCount = vi.fn();
vi.mock("@/lib/prisma", () => ({
  prisma: {
    supportTicket: {
      get count() {
        return ticketCount;
      },
    },
  },
}));

const cachedQueryImpl = vi.fn((fn: () => Promise<unknown>, _opts: unknown) => fn());
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => Promise<unknown>, opts: unknown) => cachedQueryImpl(fn, opts),
}));

const USER = { id: "da-1" };

let getDistrictNotifications: typeof import("@/lib/district/notifications").getDistrictNotifications;

beforeEach(async () => {
  vi.clearAllMocks();
  ticketCount.mockResolvedValue(0);
  vi.resetModules();
  ({ getDistrictNotifications } = await import("@/lib/district/notifications"));
});

describe("getDistrictNotifications — per-request dedupe", () => {
  it("runs the underlying count once for the same user and equal-but-different scope objects", async () => {
    const scopeA = { kind: "districts" as const, districts: ["Alabel 1"] };
    const scopeB = { kind: "districts" as const, districts: ["Alabel 1"] };

    await getDistrictNotifications(USER, scopeA);
    await getDistrictNotifications(USER, scopeB);

    expect(cachedQueryImpl).toHaveBeenCalledTimes(1);
    expect(ticketCount).toHaveBeenCalledTimes(1);
  });

  it("runs the underlying count twice for two genuinely different scopes — never shared across tenancy", async () => {
    const scopeA = { kind: "districts" as const, districts: ["Alabel 1"] };
    const scopeB = { kind: "districts" as const, districts: ["Alabel 2"] };

    await getDistrictNotifications(USER, scopeA);
    await getDistrictNotifications(USER, scopeB);

    expect(cachedQueryImpl).toHaveBeenCalledTimes(2);
    expect(ticketCount).toHaveBeenCalledTimes(2);
  });

  it("runs the underlying count twice for two different users over the same scope", async () => {
    const scope = { kind: "districts" as const, districts: ["Alabel 1"] };

    await getDistrictNotifications({ id: "da-1" }, scope);
    await getDistrictNotifications({ id: "da-2" }, scope);

    expect(cachedQueryImpl).toHaveBeenCalledTimes(2);
  });
});
