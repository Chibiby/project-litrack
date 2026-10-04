import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A period wholly before the current month is cached for 3600 s (the raw
 * entry, the facet's only entry); the current or default period keeps the
 * 300 s profile. A past
 * attendance range keys and queries on its own end, not on today, so it stays
 * warm across Manila midnight.
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

type CacheOptions = { keyParts: string[]; tags: string[]; profile?: string; revalidate?: number };
const cachedQuery = vi.fn(async (fn: () => Promise<unknown>, _opts: CacheOptions) => fn());
vi.mock("@/lib/cache/unstable", () => ({
  cachedQuery: (fn: () => Promise<unknown>, opts: CacheOptions) => cachedQuery(fn, opts),
}));
vi.mock("@/lib/demo/session", () => ({ isDemoVisible: async () => false }));

const { SUMMARY_FACETS } = await import("@/lib/summary/facets");
const { monthEndKey, isPastMonth } = await import("@/lib/summary/shape/months");

const SCHOOLS = [
  { id: "s1", name: "Alabel CES", schoolIdCode: "130001", district: "Alabel 1", division: "Sarangani", region: "XII", isActive: true },
];
const ALL = { kind: "all" } as const;

// Manila noon on 2026-10-04 (UTC+8).
const NOW = new Date("2026-10-04T04:00:00Z");
// Manila 2026-10-06, after a midnight or two.
const LATER = new Date("2026-10-06T04:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  schoolFindMany.mockResolvedValue(SCHOOLS);
  queryRaw.mockResolvedValue([]);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

function entries() {
  const calls = cachedQuery.mock.calls.map(([, o]) => o);
  // No per-scope shaped entry exists any more.
  expect(calls.some((o) => o.keyParts[0] === "summary")).toBe(false);
  return { raw: calls.find((o) => o.keyParts[0] === "summary-raw") };
}

async function run(id: keyof typeof SUMMARY_FACETS, params: Record<string, string>) {
  cachedQuery.mockClear();
  queryRaw.mockClear();
  await SUMMARY_FACETS[id].load(ALL, params);
  return entries();
}

describe("month helpers", () => {
  it("monthEndKey and isPastMonth", () => {
    expect(monthEndKey("2026-09")).toBe("2026-09-30");
    expect(monthEndKey("2026-02")).toBe("2026-02-28");
    expect(monthEndKey("2026-12")).toBe("2026-12-31");
    expect(isPastMonth("2026-09", "2026-10-04")).toBe(true);
    expect(isPastMonth("2026-10", "2026-10-04")).toBe(false);
  });
});

describe("past period TTL", () => {
  it("reading-behavior: a past month is 3600 s, the current month and the default stay 300 s", async () => {
    const past = await run("reading-behavior", { month: "2026-07" });
    expect(past.raw?.revalidate).toBe(3600);

    // Default is July of this school year (2026-07): also past by October.
    const dflt = await run("reading-behavior", {});
    expect(dflt.raw?.revalidate).toBe(3600);

    const current = await run("reading-behavior", { month: "2026-10" });
    expect(current.raw?.revalidate).toBeUndefined();
    expect(current.raw?.profile).toBe("reference");
  });

  it.each(["attendance", "reading-levels"] as const)(
    "%s: a range ending before the current month is 3600 s; touching it or the default stays 300 s",
    async (id) => {
      const past = await run(id, { from: "2026-07", to: "2026-09" });
      expect(past.raw?.revalidate).toBe(3600);

      const touching = await run(id, { from: "2026-08", to: "2026-10" });
      expect(touching.raw?.revalidate).toBeUndefined();

      const dflt = await run(id, {});
      expect(dflt.raw?.revalidate).toBeUndefined();
      expect(dflt.raw?.profile).toBe("reference");
    }
  );

  it.each(["learners", "compliance", "profiling", "aral", "end-of-term"] as const)(
    "%s has no month period and keeps 300 s",
    async (id) => {
      const e = await run(id, {});
      expect(e.raw?.revalidate).toBeUndefined();
    }
  );
});

describe("attendance: a past range does not depend on today", () => {
  const PAST = { from: "2026-07", to: "2026-09" };

  it("uses the range end in the cache keys and the SQL params, unchanged at midnight", async () => {
    const first = await run("attendance", PAST);
    const sqlFirst = JSON.stringify(queryRaw.mock.calls[0]?.[0]?.values);
    expect(first.raw?.keyParts.join("|")).toContain("2026-09-30");
    expect(sqlFirst).toContain("2026-09-30");
    expect(sqlFirst).not.toContain("2026-10-04");

    vi.setSystemTime(LATER);
    const second = await run("attendance", PAST);
    expect(second.raw?.keyParts).toEqual(first.raw?.keyParts);
    expect(JSON.stringify(queryRaw.mock.calls[0]?.[0]?.values)).toBe(sqlFirst);
  });

  it("a range touching today still keys on today", async () => {
    const first = await run("attendance", { from: "2026-08", to: "2026-10" });
    expect(first.raw?.keyParts.join("|")).toContain("2026-10-04");

    vi.setSystemTime(LATER);
    const second = await run("attendance", { from: "2026-08", to: "2026-10" });
    expect(second.raw?.keyParts).not.toEqual(first.raw?.keyParts);
    expect(second.raw?.keyParts.join("|")).toContain("2026-10-06");
  });

  it("a past `to` with a defaulted `from` clamps too", async () => {
    const e = await run("attendance", { to: "2026-09" });
    expect(e.raw?.keyParts.join("|")).toContain("2026-09-30");
    expect(e.raw?.revalidate).toBe(3600);
  });
});

describe("compliance keeps keying on today", () => {
  it("has no range, so its key follows today", async () => {
    const first = await run("compliance", {});
    expect(first.raw?.keyParts.join("|")).toContain("2026-10-04");
  });
});
