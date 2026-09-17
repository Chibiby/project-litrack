import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GET /auth/confirm` — the server-side landing pad for a password recovery
 * email. It exchanges the emailed `token_hash` for a session via
 * `verifyOtp` (so the cookie write actually sticks, unlike the Server
 * Component `/auth/reset` used to attempt), then redirects to `/auth/reset`.
 *
 * What's pinned:
 *  - a valid recovery token_hash verifies and redirects to plain /auth/reset.
 *  - `type` must be exactly "recovery" — any other type is refused.
 *  - a missing token_hash is refused without calling verifyOtp at all.
 *  - a verifyOtp failure redirects with a safe `?error=`, never the raw
 *    Supabase error text.
 */

const verifyOtp = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp } }),
}));

import { GET } from "@/app/auth/confirm/route";
import { NextRequest } from "next/server";

function request(path: string): NextRequest {
  return new NextRequest(new URL(path, "https://litrack.example.org"));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /auth/confirm", () => {
  it("verifies a recovery token_hash and redirects to /auth/reset", async () => {
    verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });

    const res = await GET(request("/auth/confirm?token_hash=abc123&type=recovery"));

    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc123" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://litrack.example.org/auth/reset");
  });

  it("refuses a non-recovery type without calling verifyOtp", async () => {
    const res = await GET(request("/auth/confirm?token_hash=abc123&type=magiclink"));

    expect(verifyOtp).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/reset");
    expect(location.searchParams.get("error")).toMatch(/invalid or has expired/i);
  });

  it("refuses a missing token_hash without calling verifyOtp", async () => {
    const res = await GET(request("/auth/confirm?type=recovery"));

    expect(verifyOtp).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/reset");
    expect(location.searchParams.get("error")).toMatch(/invalid or has expired/i);
  });

  it("redirects with a safe error and never echoes the raw Supabase error text", async () => {
    verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { message: 'token_hash "abc123" for user 42 is expired: relation error' },
    });

    const res = await GET(request("/auth/confirm?token_hash=abc123&type=recovery"));

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/reset");
    const error = location.searchParams.get("error") ?? "";
    expect(error).toMatch(/invalid or has expired/i);
    expect(error).not.toMatch(/relation|user 42|abc123/);
  });
});
