import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `peekRateLimit` reads a window without spending from it.
 *
 * That distinction is the whole basis of the account-guessing throttle: charge
 * only the lookups that failed, but refuse everything once the limit is reached.
 * If a peek ever recorded an attempt, a teacher signing in normally would spend
 * the allowance meant for guessers.
 *
 * No Upstash here, so this exercises the in-memory window — what dev and
 * unconfigured deployments use. The Redis path is one pipeline of the same
 * semantics.
 */

vi.mock("@/lib/cache/upstash", () => ({
  upstashCommand: async () => null,
  upstashPipeline: async () => null,
}));

import { checkRateLimit, peekRateLimit } from "@/lib/rate-limit";

const RATE = { limit: 3, windowMs: 60_000 } as const;

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("peekRateLimit", () => {
  it("reports the window without consuming an attempt", async () => {
    const key = `peek:${Math.random()}`;
    expect((await peekRateLimit(key, RATE)).ok).toBe(true);
    expect((await peekRateLimit(key, RATE)).ok).toBe(true);
    expect((await peekRateLimit(key, RATE)).ok).toBe(true);
    // Three peeks recorded nothing, so all three attempts are still available.
    expect((await checkRateLimit(key, RATE)).ok).toBe(true);
    expect((await checkRateLimit(key, RATE)).ok).toBe(true);
    expect((await checkRateLimit(key, RATE)).ok).toBe(true);
    expect((await checkRateLimit(key, RATE)).ok).toBe(false);
  });

  it("turns false once the limit is reached, and says how long to wait", async () => {
    const key = `peek:${Math.random()}`;
    for (let i = 0; i < RATE.limit; i++) await checkRateLimit(key, RATE);
    const gate = await peekRateLimit(key, RATE);
    expect(gate.ok).toBe(false);
    expect(gate.retryAfterMs).toBeGreaterThan(0);
    expect(gate.retryAfterMs).toBeLessThanOrEqual(RATE.windowMs);
  });

  it("says yes for a key nothing has ever touched", async () => {
    expect(await peekRateLimit(`peek:untouched:${Math.random()}`, RATE)).toEqual({
      ok: true,
      retryAfterMs: 0,
    });
  });
});
