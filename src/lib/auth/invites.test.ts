import { describe, expect, it } from "vitest";
import { generateInviteToken, hashToken } from "./invites";

describe("hashToken", () => {
  it("returns a stable sha256 hex digest", () => {
    const a = hashToken("hello");
    const b = hashToken("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken("other")).not.toBe(a);
  });
});

describe("generateInviteToken", () => {
  it("returns unique token, matching hash, and future expiry", () => {
    const first = generateInviteToken();
    const second = generateInviteToken();
    expect(first.token).not.toBe(second.token);
    expect(first.tokenHash).toBe(hashToken(first.token));
    expect(first.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
