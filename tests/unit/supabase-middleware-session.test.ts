import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getClaims = vi.fn();
const getSharedJwks = vi.fn();

/**
 * `createServerClient`'s real `setAll` cookie callback is invoked by the SDK
 * itself while refreshing a session, not by our test code directly. To reach
 * it we capture the `cookies` option `updateSession` passes in, then trigger
 * it ourselves from inside a `getClaims` mock implementation — the same place
 * the real SDK would call it, so the reassigned `supabaseResponse` closure
 * variable in middleware.ts is the one `updateSession` actually returns.
 */
let capturedCookies: {
  setAll: (
    cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[],
    headers: Record<string, string>
  ) => void;
} | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: typeof capturedCookies }) => {
    capturedCookies = options.cookies;
    return { auth: { getClaims } };
  },
}));
vi.mock("@/lib/supabase/jwks", () => ({
  getSharedJwks: (...a: unknown[]) => getSharedJwks(...a),
}));

import { updateSession } from "@/lib/supabase/middleware";

const KEYS = { keys: [{ kid: "k1", kty: "EC", key_ops: ["verify"] }] };

function request(cookie?: string) {
  return new NextRequest("https://litrack.test/teacher", {
    headers: cookie ? { cookie } : {},
  });
}

describe("updateSession", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://x.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
    getClaims.mockReset();
    getSharedJwks.mockReset();
    capturedCookies = null;
    getClaims.mockResolvedValue({
      data: { claims: { sub: "auth-1", app_metadata: { role: "TEACHER" } } },
      error: null,
    });
  });

  it("carries @supabase/ssr's no-cache headers on the response whose cookies it just set", async () => {
    getSharedJwks.mockResolvedValue(KEYS);
    // Simulate the real SDK calling our setAll callback mid-refresh, handing
    // back both a refreshed cookie and the headers that must ride along with it.
    getClaims.mockImplementation(async () => {
      capturedCookies?.setAll(
        [{ name: "sb-x-auth-token", value: "refreshed", options: { path: "/" } }],
        { "Cache-Control": "no-store, no-cache" }
      );
      return {
        data: { claims: { sub: "auth-1", app_metadata: { role: "TEACHER" } } },
        error: null,
      };
    });

    const { supabaseResponse } = await updateSession(request("sb-x-auth-token=abc"));

    expect(supabaseResponse.cookies.get("sb-x-auth-token")?.value).toBe("refreshed");
    expect(supabaseResponse.headers.get("Cache-Control")).toBe("no-store, no-cache");
  });

  it("verifies a session with the shared key set when one is available", async () => {
    getSharedJwks.mockResolvedValue(KEYS);
    const { user } = await updateSession(request("sb-x-auth-token=abc"));
    expect(getClaims).toHaveBeenCalledWith(undefined, { jwks: KEYS });
    expect(user).toEqual({ id: "auth-1", role: "TEACHER" });
  });

  it("falls back to the SDK's own key fetch when the shared set is unavailable", async () => {
    getSharedJwks.mockResolvedValue(undefined);
    const { user } = await updateSession(request("sb-x-auth-token=abc"));
    expect(getClaims).toHaveBeenCalledWith(undefined, undefined);
    expect(user?.id).toBe("auth-1");
  });

  it("skips the shared key lookup for a signed-out request", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const { user } = await updateSession(request());
    expect(getSharedJwks).not.toHaveBeenCalled();
    expect(user).toBeNull();
  });

  it("treats a verification failure as signed out", async () => {
    getSharedJwks.mockResolvedValue(KEYS);
    getClaims.mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = await updateSession(request("sb-x-auth-token=abc"));
    expect(user).toBeNull();
    spy.mockRestore();
  });
});
