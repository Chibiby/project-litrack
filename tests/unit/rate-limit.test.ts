import { describe, expect, it } from "vitest";
import { checkRateLimit } from "@/lib/rate-limit";

// No UPSTASH_* env vars under test, so these exercise the in-memory fallback.
// That is deliberate: the fallback is what runs on local dev and on preview
// deploys without Redis, so it needs to hold the window on its own.
describe("checkRateLimit", () => {
  it("allows attempts under the limit", async () => {
    const key = `test-allow-${Date.now()}-${Math.random()}`;
    const a = await checkRateLimit(key, { limit: 3, windowMs: 60_000 });
    const b = await checkRateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(a.retryAfterMs).toBe(0);
  });

  it("blocks when limit is exceeded and reports retryAfterMs", async () => {
    const key = `test-block-${Date.now()}-${Math.random()}`;
    const opts = { limit: 2, windowMs: 60_000 };
    expect((await checkRateLimit(key, opts)).ok).toBe(true);
    expect((await checkRateLimit(key, opts)).ok).toBe(true);
    const blocked = await checkRateLimit(key, opts);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("isolates keys", async () => {
    const t = Date.now();
    const a = `key-a-${t}-${Math.random()}`;
    const b = `key-b-${t}-${Math.random()}`;
    const opts = { limit: 1, windowMs: 60_000 };
    expect((await checkRateLimit(a, opts)).ok).toBe(true);
    expect((await checkRateLimit(a, opts)).ok).toBe(false);
    expect((await checkRateLimit(b, opts)).ok).toBe(true);
  });
});
