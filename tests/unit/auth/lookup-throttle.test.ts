import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The account-guessing throttle.
 *
 * Two properties matter, and they pull in opposite directions:
 *   - a school computer lab of teachers typing their OWN addresses must never
 *     be locked out, so a successful lookup costs nothing;
 *   - once an address has spent its allowance on misses, even a lookup that
 *     WOULD have succeeded is refused — otherwise the block itself answers the
 *     question ("this address exists, that one doesn't").
 */

const checkRateLimit = vi.fn();
const peekRateLimit = vi.fn();

vi.mock("@/lib/rate-limit", () => ({
  get checkRateLimit() {
    return checkRateLimit;
  },
  get peekRateLimit() {
    return peekRateLimit;
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9, 70.41.3.18" }),
}));

import { AppError } from "@/lib/errors/app-error";
import { assertLookupAllowed, recordFailedLookup } from "@/lib/auth/lookup-throttle";

beforeEach(() => {
  vi.clearAllMocks();
  peekRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
});

describe("lookup throttle", () => {
  it("keys on the client address, the first entry in x-forwarded-for", async () => {
    await assertLookupAllowed();
    expect(peekRateLimit).toHaveBeenCalledWith(
      "login:lookup-miss:ip:203.0.113.9",
      expect.any(Object)
    );
  });

  it("allows a lookup while the address is under the limit, and charges nothing", async () => {
    await expect(assertLookupAllowed()).resolves.toBeUndefined();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("refuses every lookup once the address is over it, with a wait", async () => {
    peekRateLimit.mockResolvedValue({ ok: false, retryAfterMs: 4 * 60_000 });
    await expect(assertLookupAllowed()).rejects.toMatchObject({
      code: "AUTH_TOO_MANY_ATTEMPTS",
      message: "Too many attempts. Try again in 4 minutes.",
    });
    await expect(assertLookupAllowed()).rejects.toBeInstanceOf(AppError);
  });

  it("charges the window only when a lookup actually failed", async () => {
    await recordFailedLookup();
    expect(checkRateLimit).toHaveBeenCalledWith(
      "login:lookup-miss:ip:203.0.113.9",
      expect.any(Object)
    );
  });
});
