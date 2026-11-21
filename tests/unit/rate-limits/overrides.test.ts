import { describe, expect, it } from "vitest";
import {
  RATE_LIMITS,
  applyRateLimitOverride,
  isValidRateLimitOverride,
  parseRateLimitOverrides,
  rateLimitIdOf,
} from "@/lib/rate-limits/catalog";

const MIN = 60_000;

describe("parseRateLimitOverrides", () => {
  it("reads missing or broken JSON as no overrides", () => {
    expect(parseRateLimitOverrides(null)).toEqual({});
    expect(parseRateLimitOverrides("")).toEqual({});
    expect(parseRateLimitOverrides("{not json")).toEqual({});
    expect(parseRateLimitOverrides("[1,2]")).toEqual({});
  });

  it("keeps known ids with valid numbers and drops the rest", () => {
    const raw = JSON.stringify({
      login: { limit: 50, windowMs: 10 * MIN },
      chat: { limit: 0, windowMs: MIN },
      register: { limit: 5, windowMs: 90_000 },
      madeUp: { limit: 5, windowMs: MIN },
    });
    expect(parseRateLimitOverrides(raw)).toEqual({ login: { limit: 50, windowMs: 10 * MIN } });
  });
});

describe("isValidRateLimitOverride", () => {
  it("accepts 1–10,000 attempts within 1–1,440 whole minutes", () => {
    expect(isValidRateLimitOverride({ limit: 1, windowMs: MIN })).toBe(true);
    expect(isValidRateLimitOverride({ limit: 10_000, windowMs: 1440 * MIN })).toBe(true);
    expect(isValidRateLimitOverride({ limit: 10_001, windowMs: MIN })).toBe(false);
    expect(isValidRateLimitOverride({ limit: 1.5, windowMs: MIN })).toBe(false);
    expect(isValidRateLimitOverride({ limit: 5, windowMs: 1441 * MIN })).toBe(false);
    expect(isValidRateLimitOverride({ limit: 5, windowMs: 0 })).toBe(false);
    expect(isValidRateLimitOverride({ limit: "5", windowMs: MIN })).toBe(false);
  });
});

describe("applyRateLimitOverride", () => {
  it("finds a catalog limit by the object call sites pass", () => {
    expect(rateLimitIdOf(RATE_LIMITS.login)).toBe("login");
    expect(rateLimitIdOf({ limit: 10, windowMs: 5 * MIN })).toBeUndefined();
  });

  it("enforces the override when one is stored", () => {
    expect(
      applyRateLimitOverride(RATE_LIMITS.login, { login: { limit: 99, windowMs: 2 * MIN } })
    ).toEqual({ limit: 99, windowMs: 2 * MIN });
  });

  it("keeps the default when only another limit is changed", () => {
    expect(
      applyRateLimitOverride(RATE_LIMITS.login, { chat: { limit: 99, windowMs: 2 * MIN } })
    ).toEqual({ limit: RATE_LIMITS.login.limit, windowMs: RATE_LIMITS.login.windowMs });
  });

  it("leaves an ad-hoc limit alone", () => {
    const adHoc = { limit: 3, windowMs: MIN };
    expect(applyRateLimitOverride(adHoc, { login: { limit: 99, windowMs: 2 * MIN } })).toEqual(adHoc);
  });
});
