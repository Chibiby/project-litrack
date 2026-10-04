import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Entry = { value: unknown; stale: boolean };

const state = vi.hoisted(() => ({
  loads: new Map<string, ReturnType<typeof import("vitest").vi.fn>>(),
  callOrder: [] as string[],
  inFlight: 0,
  maxInFlight: 0,
  store: new Map<string, { value: unknown; stale: boolean }>(),
  pending: new Map<string, Promise<unknown>>(),
  cacheOpts: [] as { key: string; tags?: string[]; revalidate?: number }[],
}));
const { loads, callOrder, store, pending } = state;

vi.mock("server-only", () => ({}));
/**
 * Mirrors next's unstable_cache in a route handler (unstable-cache.js):
 * key = `${fn.toString()}-${keyParts}`; miss runs fn and stores; fresh hit
 * returns the stored value without running fn; stale hit returns the stored
 * value and runs fn ONCE in the background (deduped per key through
 * pendingRevalidates), storing the result when it lands.
 */
vi.mock("next/cache", () => ({
  unstable_cache:
    <T,>(fn: () => Promise<T>, keyParts: string[], opts: { tags?: string[]; revalidate?: number }) =>
    async () => {
      const key = `${fn.toString()}-${keyParts.join(",")}`;
      state.cacheOpts.push({ key, tags: opts.tags, revalidate: opts.revalidate });
      const entry = state.store.get(key) as Entry | undefined;
      if (entry) {
        if (entry.stale && !state.pending.has(key)) {
          state.pending.set(
            key,
            fn()
              .then((value) => state.store.set(key, { value, stale: false }))
              .catch(() => undefined)
              .finally(() => state.pending.delete(key)),
          );
        }
        return entry.value as T;
      }
      const value = await fn();
      state.store.set(key, { value, stale: false });
      return value;
    },
}));
/** The warm reads nothing from the database itself: any prisma use is a bug. */
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
/**
 * Each facet's `warmRaw` stands in for one division raw load (one SQL run).
 * The key equality with the page path is held against the real facets in
 * scoped-raw.test.ts ("(7) the warm").
 */
vi.mock("@/lib/summary/facets", async () => {
  const { SUMMARY_FACET_IDS } = await import("@/lib/summary/types");
  const facets: Record<string, { warmRaw: ReturnType<typeof vi.fn>; load: ReturnType<typeof vi.fn> }> = {};
  for (const id of SUMMARY_FACET_IDS) {
    const warmRaw = vi.fn(async () => {
      state.inFlight += 1;
      state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
      state.callOrder.push(id);
      await Promise.resolve();
      state.inFlight -= 1;
    });
    state.loads.set(id, warmRaw);
    // The warm must never shape a scope.
    facets[id] = {
      warmRaw,
      load: vi.fn(async () => {
        throw new Error("load called by the warm");
      }),
    };
  }
  return { SUMMARY_FACETS: facets, SUMMARY_CACHE_VERSION: "v3" };
});

import { NextRequest } from "next/server";
import { SUMMARY_FACETS } from "@/lib/summary/facets";
import { SUMMARY_FACET_IDS } from "@/lib/summary/types";
import { WARM_TTL_SECONDS, warmDivisionRaw, warmOnce, type WarmOutcome } from "@/lib/summary/warm";
import { GET } from "@/app/api/cron/summary-warm/route";

const secret = { authorization: "Bearer s3cret-value" };
const RAW_ORDER = [...SUMMARY_FACET_IDS];

function req(headers: Record<string, string> = {}) {
  return new NextRequest(new URL("/api/cron/summary-warm", "https://litrack.example.org"), {
    headers,
  });
}

/** Raw loads run so far (one per `warmRaw` call = one division SQL run). */
function totalLoads() {
  return [...loads.values()].reduce((n, l) => n + l.mock.calls.length, 0);
}

function scopeLoads() {
  return Object.values(SUMMARY_FACETS).reduce(
    (n, f) => n + (f.load as unknown as ReturnType<typeof vi.fn>).mock.calls.length,
    0
  );
}

/** The single warm entry's key (the only key warmOnce touches). */
function warmKey() {
  const keys = [...new Set(state.cacheOpts.map((o) => o.key))];
  expect(keys).toHaveLength(1);
  return keys[0];
}

async function settle() {
  await Promise.all([...pending.values()]);
}

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
  store.clear();
  pending.clear();
  state.cacheOpts.length = 0;
  state.inFlight = 0;
  state.maxInFlight = 0;
  process.env.CRON_SECRET = "s3cret-value";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("warmDivisionRaw", () => {
  it("loads each of the 8 facets' raw entry exactly once, in order, one at a time, and shapes no scope", async () => {
    const report = await warmDivisionRaw();
    expect(report).toHaveLength(8);
    expect(report.every((r) => r.ok)).toBe(true);
    expect(callOrder).toEqual(RAW_ORDER);
    for (const id of SUMMARY_FACET_IDS) expect(loads.get(id)!).toHaveBeenCalledTimes(1);
    expect(state.maxInFlight).toBe(1);
    expect(scopeLoads()).toBe(0);
  });

  it("one facet throwing does not stop the others", async () => {
    loads.get("attendance")!.mockRejectedValueOnce(new Error("boom"));
    const report = await warmDivisionRaw();
    expect(report).toHaveLength(8);
    expect(report.filter((r) => !r.ok).map((r) => r.facetId)).toEqual(["attendance"]);
    expect(report.find((r) => !r.ok)?.error).toBe("boom");
    expect(loads.get("aral")!).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("warmOnce (the cached warm)", () => {
  it("miss: runs exactly 8 raw loads, in order, and stores the outcome tagged divisionSummary for a day", async () => {
    const out = await warmOnce();
    expect(callOrder).toEqual(RAW_ORDER);
    expect(totalLoads()).toBe(8);
    expect(state.maxInFlight).toBe(1);
    expect(out.failures).toEqual([]);
    expect(out.results).toHaveLength(8);
    expect(out.results[0]).toEqual({ facetId: SUMMARY_FACET_IDS[0], ok: true, ms: expect.any(Number) });

    const key = warmKey();
    expect(key).toContain("summary-warm,v3");
    expect(store.get(key)?.value).toEqual(out);
    const opts = state.cacheOpts[0];
    expect(opts.tags).toContain("division-summary");
    expect(opts.revalidate).toBe(86400);
    expect(WARM_TTL_SECONDS).toBe(86400);
  });

  it("hit: returns the stored outcome with no raw loads", async () => {
    const first = await warmOnce();
    for (let tick = 0; tick < 5; tick++) {
      expect(await warmOnce()).toEqual(first);
    }
    expect(totalLoads()).toBe(8);
    expect(pending.size).toBe(0);
  });

  it("stale: returns the stored outcome and re-warms at most once in the background", async () => {
    const first = await warmOnce();
    const key = warmKey();
    store.set(key, { value: first, stale: true });
    callOrder.length = 0;

    // Several ticks land while the refresh is still running: one re-warm only.
    const ticks = await Promise.all([warmOnce(), warmOnce(), warmOnce()]);
    for (const t of ticks) expect(t).toEqual(first);
    await settle();

    expect(callOrder).toEqual(RAW_ORDER);
    expect(totalLoads()).toBe(16);
    const refreshed = store.get(key)!;
    expect(refreshed.stale).toBe(false);
    expect((refreshed.value as WarmOutcome).at).toBeGreaterThanOrEqual(first.at);

    // Fresh again: the next tick is a plain hit.
    await warmOnce();
    await settle();
    expect(totalLoads()).toBe(16);
  });

  it("a deploy or a divisionSummary bust (entry gone) runs the warm again, once", async () => {
    await warmOnce();
    store.delete(warmKey());
    await warmOnce();
    await warmOnce();
    expect(totalLoads()).toBe(16);
  });

  describe("Manila day change", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("the key contains the Manila date key", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-04T10:00:00+08:00"));
      await warmOnce();
      expect(warmKey()).toContain("summary-warm,v3,2026-10-04");
    });

    it("same Manila day: later ticks hit, no loads", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-04T00:05:00+08:00"));
      await warmOnce();
      vi.setSystemTime(new Date("2026-10-04T23:55:00+08:00"));
      await warmOnce();
      expect(totalLoads()).toBe(8);
    });

    it("next Manila day: exactly one warm, then hits", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-04T23:55:00+08:00"));
      await warmOnce();
      vi.setSystemTime(new Date("2026-10-05T00:00:00+08:00"));
      await warmOnce();
      await warmOnce();
      expect(totalLoads()).toBe(16);
    });
  });

  it("failures are stored with the outcome, so the next tick does not re-warm", async () => {
    loads.get("aral")!.mockRejectedValueOnce(new Error("x"));
    const out = await warmOnce();
    expect(out.failures).toEqual([{ facetId: "aral", error: "x" }]);
    expect(out.results.filter((r) => r.ok)).toHaveLength(7);
    expect(loads.get("compliance")!).toHaveBeenCalledTimes(1); // the rest still ran

    expect(await warmOnce()).toEqual(out);
    expect(totalLoads()).toBe(8);
  });
});

describe("GET /api/cron/summary-warm", () => {
  it("refuses with no header, wrong secret, and unset secret", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ authorization: "Bearer nope" }))).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await GET(req(secret))).status).toBe(401);
    expect(totalLoads()).toBe(0);
    expect(store.size).toBe(0);
  });

  it("answers 502 with the failures and per-facet results when a raw load fails", async () => {
    loads.get("aral")!.mockRejectedValueOnce(new Error("x"));
    const res = await GET(req(secret));
    expect(res.status).toBe(502);
    const body = (await res.json()) as WarmOutcome;
    expect(body.failures).toEqual([{ facetId: "aral", error: "x" }]);
    expect(body.results).toHaveLength(8);

    // The stored failing outcome is served (still 502) without re-warming.
    expect((await GET(req(secret))).status).toBe(502);
    expect(totalLoads()).toBe(8);
  });

  it("miss: warms and answers 200; later ticks answer the stored outcome with no loads", async () => {
    const res = await GET(req(secret));
    expect(res.status).toBe(200);
    const body = (await res.json()) as WarmOutcome;
    expect(body.failures).toEqual([]);
    expect(body.results).toHaveLength(8);

    const again = await GET(req(secret));
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(body);
    expect(totalLoads()).toBe(8);
  });
});

describe("isDemoVisible in a cron request", () => {
  it("is false when no cookie is sent", async () => {
    vi.resetModules();
    vi.doMock("next/headers", () => ({
      cookies: async () => ({ get: () => undefined, has: () => false }),
    }));
    const { isDemoVisible } = await import("@/lib/demo/session");
    expect(await isDemoVisible()).toBe(false);
    vi.doUnmock("next/headers");
  });
});

describe("cron schedule wiring", () => {
  const root = resolve(__dirname, "../../..");
  it("worker.js CRON_ROUTES and wrangler.jsonc both carry */5 * * * *", () => {
    const worker = readFileSync(resolve(root, "worker.js"), "utf8");
    const wrangler = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");
    expect(worker).toContain('"*/5 * * * *": "/api/cron/summary-warm"');
    expect(wrangler).toMatch(/"crons":\s*\[[^\]]*"\*\/5 \* \* \* \*"/);
    expect(wrangler).toContain('"0 16 * * *"');
    expect(wrangler).toContain('"30 16 * * 6"');
  });
});
