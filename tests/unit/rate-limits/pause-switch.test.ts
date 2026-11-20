import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pause switch on Developer Controls -> Rate limits. Outside tests the
 * limiter reads `rateLimits.paused`; "true" allows everything, anything else
 * (including a failed read) keeps the limits on.
 */

const findUnique = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { systemSetting: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));
// No shared backend: the in-memory window answers.
vi.mock("@/lib/cache/upstash", () => ({
  upstashPipeline: async () => null,
  upstashCommand: async () => null,
}));
vi.mock("@/lib/rate-limit-d1", () => ({ d1Check: async () => null, d1Peek: async () => null }));

const { checkRateLimit, peekRateLimit, forgetRateLimitPause } = await import("@/lib/rate-limit");

const ONE = { limit: 1, windowMs: 60_000 };

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  findUnique.mockReset();
  forgetRateLimitPause();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rate limit pause switch", () => {
  it("allows every attempt while paused", async () => {
    findUnique.mockResolvedValue({ value: "true" });
    const key = `pause-on:${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit(key, ONE)).ok).toBe(true);
    }
    expect((await peekRateLimit(key, ONE)).ok).toBe(true);
  });

  it("enforces limits when the switch is off", async () => {
    findUnique.mockResolvedValue({ value: "false" });
    const key = `pause-off:${Math.random()}`;
    expect((await checkRateLimit(key, ONE)).ok).toBe(true);
    expect((await checkRateLimit(key, ONE)).ok).toBe(false);
  });

  it("enforces limits when the switch was never set", async () => {
    findUnique.mockResolvedValue(null);
    const key = `pause-unset:${Math.random()}`;
    await checkRateLimit(key, ONE);
    expect((await checkRateLimit(key, ONE)).ok).toBe(false);
  });

  it("keeps limits on when the switch cannot be read", async () => {
    findUnique.mockRejectedValue(new Error("db down"));
    const key = `pause-error:${Math.random()}`;
    await checkRateLimit(key, ONE);
    expect((await checkRateLimit(key, ONE)).ok).toBe(false);
  });

  it("reads the switch once per 10 seconds, not once per attempt", async () => {
    findUnique.mockResolvedValue({ value: "true" });
    const key = `pause-cache:${Math.random()}`;
    await checkRateLimit(key, ONE);
    await checkRateLimit(key, ONE);
    await peekRateLimit(key, ONE);
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
