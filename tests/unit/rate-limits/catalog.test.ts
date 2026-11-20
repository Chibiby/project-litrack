import { describe, expect, it } from "vitest";
import {
  RATE_LIMITS,
  RATE_LIMIT_SCOPE_LABELS,
  RATE_LIMIT_SCOPE_ORDER,
  formatRateWindow,
} from "@/lib/rate-limits/catalog";
import { LOGIN_RATE } from "@/lib/auth/login-gates";
import { LOOKUP_FAILURE_RATE } from "@/lib/auth/lookup-throttle";
import { AVATAR_UPLOAD_RATE_LIMIT } from "@/lib/avatars/limits";

describe("rate limit catalog", () => {
  it("gives every limit a positive allowance and a label", () => {
    for (const [id, e] of Object.entries(RATE_LIMITS)) {
      expect(e.limit, id).toBeGreaterThan(0);
      expect(e.windowMs, id).toBeGreaterThan(0);
      expect(e.label.trim(), id).not.toBe("");
      expect(e.description.trim(), id).not.toBe("");
      expect(RATE_LIMIT_SCOPE_ORDER, id).toContain(e.scope);
    }
  });

  it("lists same-network limits first", () => {
    expect(RATE_LIMIT_SCOPE_ORDER[0]).toBe("network");
    expect(RATE_LIMIT_SCOPE_LABELS.network).toMatch(/same network/);
    const network = Object.values(RATE_LIMITS).filter((e) => e.scope === "network");
    expect(network.map((e) => e.label)).toEqual(
      expect.arrayContaining(["School list", "Unknown or taken emails"])
    );
  });

  it("is the source the enforcing modules read", () => {
    expect(LOGIN_RATE).toBe(RATE_LIMITS.login);
    expect(LOOKUP_FAILURE_RATE).toBe(RATE_LIMITS.lookupFailure);
    expect(AVATAR_UPLOAD_RATE_LIMIT).toBe(RATE_LIMITS.avatarUpload);
  });

  it("keeps the numbers the limits had before the catalog", () => {
    expect(RATE_LIMITS.schoolsList).toMatchObject({ limit: 60, windowMs: 60_000 });
    expect(RATE_LIMITS.login).toMatchObject({ limit: 10, windowMs: 5 * 60_000 });
    expect(RATE_LIMITS.lookupFailure).toMatchObject({ limit: 10, windowMs: 10 * 60_000 });
    expect(RATE_LIMITS.schoolFailedSignIn).toMatchObject({ limit: 20, windowMs: 15 * 60_000 });
    expect(RATE_LIMITS.register).toMatchObject({ limit: 5, windowMs: 15 * 60_000 });
  });
});

describe("formatRateWindow", () => {
  it.each([
    [60_000, "1 minute"],
    [5 * 60_000, "5 minutes"],
    [60 * 60_000, "1 hour"],
    [2 * 60 * 60_000, "2 hours"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatRateWindow(ms)).toBe(text);
  });
});
