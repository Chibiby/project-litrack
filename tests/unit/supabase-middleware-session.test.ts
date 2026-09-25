import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getClaims = vi.fn();
const getSharedJwks = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims } }),
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
    getClaims.mockResolvedValue({
      data: { claims: { sub: "auth-1", app_metadata: { role: "TEACHER" } } },
      error: null,
    });
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
