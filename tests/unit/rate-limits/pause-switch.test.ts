import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pause switch on Developer Controls -> Rate limits. Outside tests the
 * limiter reads `rateLimits.paused`; "true" allows everything, anything else
 * (including a failed read) keeps the limits on.
 */

const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { systemSetting: { findMany: (...a: unknown[]) => findMany(...a) } },
}));
// No shared backend: the in-memory window answers.
vi.mock("@/lib/cache/upstash", () => ({
  upstashPipeline: async () => null,
  upstashCommand: async () => null,
}));
vi.mock("@/lib/rate-limit-d1", () => ({ d1Check: async () => null, d1Peek: async () => null }));

const { checkRateLimit, peekRateLimit, forgetRateLimitPause } = await import("@/lib/rate-limit");

const ONE = { limit: 1, windowMs: 60_000 };
const paused = (value: string) => ({ key: "rateLimits.paused", value });

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  findMany.mockReset();
  forgetRateLimitPause();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rate limit pause switch", () => {
  it("allows every attempt while paused", async () => {
    findMany.mockResolvedValue([paused("true")]);
    const key = `pause-on:${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit(key, ONE)).ok).toBe(true);
    }
    expect((await peekRateLimit(key, ONE)).ok).toBe(true);
  });

  it("enforces limits when the switch is off", async () => {
    findMany.mockResolvedValue([paused("false")]);
    const key = `pause-off:${Math.random()}`;
    expect((await checkRateLimit(key, ONE)).ok).toBe(true);
    expect((await checkRateLimit(key, ONE)).ok).toBe(false);
  });

  it("enforces limits when the switch was never set", async () => {
    findMany.mockResolvedValue([]);
    const key = `pause-unset:${Math.random()}`;
    await checkRateLimit(key, ONE);
    expect((await checkRateLimit(key, ONE)).ok).toBe(false);
  });

  it("keeps limits on when the switch cannot be read", async () => {
    findMany.mockRejectedValue(new Error("db down"));
    const key = `pause-error:${Math.random()}`;
    await checkRateLimit(key, ONE);
    expect((await checkRateLimit(key, ONE)).ok).toBe(false);
  });

  it("reads the switch once per 10 seconds, not once per attempt", async () => {
    findMany.mockResolvedValue([paused("true")]);
    const key = `pause-cache:${Math.random()}`;
    await checkRateLimit(key, ONE);
    await checkRateLimit(key, ONE);
    await peekRateLimit(key, ONE);
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});

describe("rate limits changed on the Rate limits page", () => {
  it("enforces a changed limit in place of the default", async () => {
    const { RATE_LIMITS } = await import("@/lib/rate-limits/catalog");
    findMany.mockResolvedValue([
      { key: "rateLimits.overrides", value: JSON.stringify({ supportTicket: { limit: 1, windowMs: 60_000 } }) },
    ]);
    const key = `override:${Math.random()}`;
    expect((await checkRateLimit(key, RATE_LIMITS.supportTicket)).ok).toBe(true);
    expect((await checkRateLimit(key, RATE_LIMITS.supportTicket)).ok).toBe(false);
  });

  it("uses the default when the stored overrides are broken", async () => {
    const { RATE_LIMITS } = await import("@/lib/rate-limits/catalog");
    findMany.mockResolvedValue([{ key: "rateLimits.overrides", value: "{broken" }]);
    const key = `override-bad:${Math.random()}`;
    expect((await checkRateLimit(key, RATE_LIMITS.supportTicket)).ok).toBe(true);
    expect((await checkRateLimit(key, RATE_LIMITS.supportTicket)).ok).toBe(true);
  });
});
