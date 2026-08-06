import { describe, expect, it } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  it("allows attempts under the limit", () => {
    const key = `test-allow-${Date.now()}-${Math.random()}`;
    const a = checkRateLimit(key, { limit: 3, windowMs: 60_000 });
    const b = checkRateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.retryAfterMs).toBe(0);
  });

  it("blocks when limit is exceeded and reports retryAfterMs", () => {
    const key = `test-block-${Date.now()}-${Math.random()}`;
    const opts = { limit: 2, windowMs: 60_000 };
    expect(checkRateLimit(key, opts).ok).toBe(true);
    expect(checkRateLimit(key, opts).ok).toBe(true);
    const blocked = checkRateLimit(key, opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates keys", () => {
    const t = Date.now();
    const a = `key-a-${t}-${Math.random()}`;
    const b = `key-b-${t}-${Math.random()}`;
    const opts = { limit: 1, windowMs: 60_000 };
    expect(checkRateLimit(a, opts).ok).toBe(true);
    expect(checkRateLimit(a, opts).ok).toBe(false);
    expect(checkRateLimit(b, opts).ok).toBe(true);
  });
});
