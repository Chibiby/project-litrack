import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /auth/confirm/verify` — the only place in the recovery flow that
 * calls `supabase.auth.verifyOtp`. Reached exclusively via the form on
 * `/auth/confirm` (see `auth-confirm-page.test.ts` for why GET must never
 * reach here on its own).
 *
 * What's pinned:
 *  - a valid recovery token_hash verifies and redirects (303, so the
 *    browser GETs rather than replays the POST) to plain /auth/reset.
 *  - `type` must be exactly "recovery" — any other type is refused without
 *    calling verifyOtp.
 *  - a missing token_hash is refused without calling verifyOtp at all.
 *  - a verifyOtp failure with no existing session redirects with a safe
 *    `?error=`, never the raw Supabase error text.
 *  - a verifyOtp failure that DOES carry an existing session (the person
 *    already completed this exchange once — a retried submit, a second
 *    tab, the back button) redirects to /auth/reset instead of the error,
 *    because they are mid-reset, not looking at a dead link.
 */

const verifyOtp = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp, getUser } }),
}));

import { POST } from "@/app/auth/confirm/verify/route";
import { NextRequest } from "next/server";

function postRequest(fields: Record<string, string>, extraHeaders: Record<string, string> = {}): NextRequest {
  const form = new URLSearchParams(fields);
  return new NextRequest("https://litrack.example.org/auth/confirm/verify", {
    method: "POST",
    body: form,
    headers: { "content-type": "application/x-www-form-urlencoded", ...extraHeaders },
  });
}

describe("POST /auth/confirm/verify — cross-site submissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: null } });
  });

  it("refuses a cross-site form post without calling verifyOtp", async () => {
    const res = await POST(
      postRequest({ token_hash: "attacker", type: "recovery" }, { "sec-fetch-site": "cross-site" })
    );
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/auth/reset?error=");
  });

  it("refuses a foreign Origin when Sec-Fetch-Site is absent", async () => {
    await POST(postRequest({ token_hash: "attacker", type: "recovery" }, { origin: "https://evil.example" }));
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("accepts a same-origin post", async () => {
    verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });
    const res = await POST(
      postRequest({ token_hash: "abc123", type: "recovery" }, { "sec-fetch-site": "same-origin" })
    );
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toBe("https://litrack.example.org/auth/reset");
  });
});

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: null } });
});

describe("POST /auth/confirm/verify", () => {
  it("verifies a recovery token_hash and redirects (303) to /auth/reset", async () => {
    verifyOtp.mockResolvedValue({ data: { session: {} }, error: null });

    const res = await POST(postRequest({ token_hash: "abc123", type: "recovery" }));

    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "abc123" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://litrack.example.org/auth/reset");
  });

  it("refuses a non-recovery type without calling verifyOtp", async () => {
    const res = await POST(postRequest({ token_hash: "abc123", type: "magiclink" }));

    expect(verifyOtp).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/reset");
    expect(location.searchParams.get("error")).toMatch(/invalid or has expired/i);
  });

  it("refuses a missing token_hash without calling verifyOtp", async () => {
    const res = await POST(postRequest({ type: "recovery" }));

    expect(verifyOtp).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/reset");
    expect(location.searchParams.get("error")).toMatch(/invalid or has expired/i);
  });

  it("redirects to /auth/reset (not the error) when verifyOtp fails but a session is already live", async () => {
    verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { message: 'token_hash "abc123" for user 42 is expired' },
    });
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });

    const res = await POST(postRequest({ token_hash: "abc123", type: "recovery" }));

    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/reset");
    expect(location.searchParams.get("error")).toBeNull();
  });

  it("redirects with a safe error when verifyOtp fails and there is no session, never echoing the raw Supabase error text", async () => {
    verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { message: 'token_hash "abc123" for user 42 is expired: relation error' },
    });
    getUser.mockResolvedValue({ data: { user: null } });

    const res = await POST(postRequest({ token_hash: "abc123", type: "recovery" }));

    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/reset");
    const error = location.searchParams.get("error") ?? "";
    expect(error).toMatch(/invalid or has expired/i);
    expect(error).not.toMatch(/relation|user 42|abc123/);
  });
});
