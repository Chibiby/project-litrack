import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * On Cloudflare, Better Auth must be built per request: a shared instance keeps
 * its context promise from the first request, and workerd refuses to settle it
 * in any other request ("This promise was created by a request that has since
 * ended"). Off Cloudflare, one instance serves the process.
 */

vi.mock("server-only", () => ({}));
const betterAuth = vi.fn(() => ({ id: Math.random() }));
vi.mock("better-auth", () => ({ betterAuth }));
vi.mock("better-auth/adapters/prisma", () => ({ prismaAdapter: () => ({}) }));
vi.mock("better-auth/next-js", () => ({ nextCookies: () => ({}) }));
vi.mock("better-auth/plugins/admin", () => ({ admin: () => ({}) }));
vi.mock("better-auth/plugins/admin/access", () => ({ adminAc: {}, userAc: {} }));
vi.mock("@/lib/prisma", () => ({ prismaFresh: {} }));
vi.mock("@/lib/app-url", () => ({ canonicalAppUrl: () => "https://example.test" }));

beforeEach(() => {
  vi.resetModules();
  betterAuth.mockClear();
  vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(40));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getAuth", () => {
  it("reuses one instance off Cloudflare", async () => {
    vi.stubEnv("LITRACK_DEPLOY_TARGET", "");
    const { getAuth } = await import("@/lib/auth/better-auth");
    expect(getAuth()).toBe(getAuth());
    expect(betterAuth).toHaveBeenCalledTimes(1);
  });

  it("never shares an instance across Cloudflare requests", async () => {
    vi.stubEnv("LITRACK_DEPLOY_TARGET", "cloudflare");
    const { getAuth } = await import("@/lib/auth/better-auth");
    // Outside a React render each call stands for a separate request.
    expect(getAuth()).not.toBe(getAuth());
    expect(betterAuth).toHaveBeenCalledTimes(2);
  });
});
