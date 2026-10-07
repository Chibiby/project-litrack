import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /auth/confirm/verify` — the only place the emailed token is looked at
 * in the recovery flow. Reached exclusively via the form on `/auth/confirm`
 * (see auth-confirm-page.test.ts for why GET must never reach here).
 *
 * What's pinned:
 *  - a live recovery token is checked with `peekResetToken` and then moved out
 *    of the URL into an httpOnly `litrack_reset` cookie scoped to `/auth`; the
 *    redirect (303, so the browser GETs rather than replays the POST) goes to a
 *    plain /auth/reset that carries no token;
 *  - the token is NEVER consumed here: `completePasswordReset` consumes it in
 *    the transaction that writes the password, so an abandoned reset page
 *    leaves the link working until it expires;
 *  - `type` must be exactly "recovery", and a missing token is refused without
 *    touching the store;
 *  - a dead token redirects with a fixed safe `?error=`, never echoing input;
 *  - a dead token from someone who already holds a live reset cookie (retried
 *    submit, second tab, back button) goes on to /auth/reset instead;
 *  - cross-site posts are refused (login CSRF).
 * Replaces the Supabase-era test in tests/unit/auth/ (deleted by T14).
 */

const peekResetToken = vi.fn();
const consumeResetToken = vi.fn();
vi.mock("@/lib/auth/password-reset", () => ({
  peekResetToken: (...args: unknown[]) => peekResetToken(...args),
  consumeResetToken: (...args: unknown[]) => consumeResetToken(...args),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn() }));

import { POST } from "@/app/auth/confirm/verify/route";
import { NextRequest, NextResponse } from "next/server";

/** The route returns NextResponse (redirects); narrow for real so `.cookies` is typed. */
function cookieOf(res: Response, name: string) {
  expect(res).toBeInstanceOf(NextResponse);
  return res instanceof NextResponse ? res.cookies.get(name) : undefined;
}

const TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo";
const EXISTING = "ZXhpc3RpbmdjdXN0b21lcnJlc2V0dG9rZW4wMDAwMDA";

function postRequest(
  fields: Record<string, string>,
  extraHeaders: Record<string, string> = {}
): NextRequest {
  const form = new URLSearchParams(fields);
  return new NextRequest("https://litrack.example.org/auth/confirm/verify", {
    method: "POST",
    body: form,
    headers: { "content-type": "application/x-www-form-urlencoded", ...extraHeaders },
  });
}

function live(expiresInMs = 30 * 60 * 1000) {
  return { authId: "auth-1", expiresAt: new Date(Date.now() + expiresInMs) };
}

function errorOf(res: Response): string {
  return new URL(res.headers.get("location")!).searchParams.get("error") ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  peekResetToken.mockResolvedValue(null);
});

describe("POST /auth/confirm/verify — cross-site submissions", () => {
  it("refuses a cross-site form post without looking at the token", async () => {
    const res = await POST(
      postRequest({ token_hash: TOKEN, type: "recovery" }, { "sec-fetch-site": "cross-site" })
    );
    expect(peekResetToken).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/auth/reset?error=");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a same-site-but-not-same-origin post (a sibling subdomain)", async () => {
    await POST(postRequest({ token_hash: TOKEN, type: "recovery" }, { "sec-fetch-site": "same-site" }));
    expect(peekResetToken).not.toHaveBeenCalled();
  });

  it("refuses a foreign Origin when Sec-Fetch-Site is absent", async () => {
    const res = await POST(
      postRequest({ token_hash: TOKEN, type: "recovery" }, { origin: "https://evil.example" })
    );
    expect(peekResetToken).not.toHaveBeenCalled();
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("accepts a same-origin post", async () => {
    peekResetToken.mockResolvedValue(live());
    const res = await POST(
      postRequest({ token_hash: TOKEN, type: "recovery" }, { "sec-fetch-site": "same-origin" })
    );
    expect(peekResetToken).toHaveBeenCalledTimes(1);
    expect(res.headers.get("location")).toBe("https://litrack.example.org/auth/reset");
  });

  it("accepts a matching Origin when Sec-Fetch-Site is absent", async () => {
    peekResetToken.mockResolvedValue(live());
    const res = await POST(
      postRequest({ token_hash: TOKEN, type: "recovery" }, { origin: "https://litrack.example.org" })
    );
    expect(res.headers.get("location")).toBe("https://litrack.example.org/auth/reset");
  });
});

describe("POST /auth/confirm/verify — a live token", () => {
  beforeEach(() => {
    peekResetToken.mockResolvedValue(live());
  });

  it("redirects (303) to a plain /auth/reset", async () => {
    const res = await POST(postRequest({ token_hash: TOKEN, type: "recovery" }));

    expect(peekResetToken).toHaveBeenCalledWith(TOKEN);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://litrack.example.org/auth/reset");
  });

  it("keeps the token out of every URL: it travels only in the cookie", async () => {
    const res = await POST(postRequest({ token_hash: TOKEN, type: "recovery" }));
    expect(res.headers.get("location")).not.toContain(TOKEN);
    expect(res.headers.get("location")).not.toContain("?");
  });

  it("sets the token as an httpOnly, lax cookie scoped to /auth", async () => {
    const res = await POST(postRequest({ token_hash: TOKEN, type: "recovery" }));

    const cookie = cookieOf(res, "litrack_reset");
    expect(cookie?.value).toBe(TOKEN);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/auth");
  });

  it("ties the cookie lifetime to the token's remaining life, never longer", async () => {
    peekResetToken.mockResolvedValue(live(10 * 60 * 1000));
    const res = await POST(postRequest({ token_hash: TOKEN, type: "recovery" }));

    const maxAge = cookieOf(res, "litrack_reset")?.maxAge ?? 0;
    expect(maxAge).toBeGreaterThan(9 * 60);
    expect(maxAge).toBeLessThanOrEqual(10 * 60);
  });

  it("never lets the cookie lifetime reach zero (a token about to expire still gets a cookie)", async () => {
    peekResetToken.mockResolvedValue(live(-5_000));
    const res = await POST(postRequest({ token_hash: TOKEN, type: "recovery" }));
    expect(cookieOf(res, "litrack_reset")?.maxAge).toBe(1);
  });

  it("does NOT consume the token: an abandoned reset page leaves the link working", async () => {
    await POST(postRequest({ token_hash: TOKEN, type: "recovery" }));
    expect(consumeResetToken).not.toHaveBeenCalled();
  });
});

describe("POST /auth/confirm/verify — refusals", () => {
  it("refuses a non-recovery type without looking at the token", async () => {
    const res = await POST(postRequest({ token_hash: TOKEN, type: "magiclink" }));

    expect(peekResetToken).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/reset");
    expect(errorOf(res)).toMatch(/invalid or has expired/i);
    expect(cookieOf(res, "litrack_reset")).toBeUndefined();
  });

  it("refuses a missing token_hash without looking at the store", async () => {
    const res = await POST(postRequest({ type: "recovery" }));

    expect(peekResetToken).not.toHaveBeenCalled();
    expect(errorOf(res)).toMatch(/invalid or has expired/i);
  });

  it("refuses an empty token_hash", async () => {
    const res = await POST(postRequest({ token_hash: "", type: "recovery" }));
    expect(peekResetToken).not.toHaveBeenCalled();
    expect(errorOf(res)).toMatch(/invalid or has expired/i);
  });

  it("refuses a missing type", async () => {
    const res = await POST(postRequest({ token_hash: TOKEN }));
    expect(peekResetToken).not.toHaveBeenCalled();
    expect(errorOf(res)).toMatch(/invalid or has expired/i);
  });

  it("redirects with a safe error and sets no cookie when the token is dead", async () => {
    peekResetToken.mockResolvedValue(null);

    const res = await POST(postRequest({ token_hash: TOKEN, type: "recovery" }));

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/auth/reset");
    expect(errorOf(res)).toMatch(/invalid or has expired/i);
    expect(cookieOf(res, "litrack_reset")).toBeUndefined();
  });

  it("says the same thing for unknown, expired and already-used, and never echoes the token", async () => {
    peekResetToken.mockResolvedValue(null);
    const a = await POST(postRequest({ token_hash: TOKEN, type: "recovery" }));
    const b = await POST(postRequest({ token_hash: "x".repeat(43), type: "recovery" }));

    expect(errorOf(a)).toBe(errorOf(b));
    expect(a.headers.get("location")).not.toContain(TOKEN);
    expect(errorOf(a)).not.toMatch(/expired token|already used|unknown|not found/i);
  });
});

describe("POST /auth/confirm/verify — a retried submit", () => {
  it("sends someone with a still-live reset cookie on to /auth/reset instead of an error", async () => {
    // The submitted token is spent or replaced; the cookie from the earlier click is live.
    peekResetToken.mockImplementation(async (token: string) => (token === EXISTING ? live() : null));

    const res = await POST(
      postRequest(
        { token_hash: TOKEN, type: "recovery" },
        { cookie: `litrack_reset=${EXISTING}` }
      )
    );

    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/auth/reset");
    expect(location.searchParams.get("error")).toBeNull();
    // The existing cookie is left alone, not replaced by the dead token.
    expect(cookieOf(res, "litrack_reset")).toBeUndefined();
  });

  it("still shows the error when the cookie they hold is dead too", async () => {
    peekResetToken.mockResolvedValue(null);

    const res = await POST(
      postRequest({ token_hash: TOKEN, type: "recovery" }, { cookie: `litrack_reset=${EXISTING}` })
    );

    expect(errorOf(res)).toMatch(/invalid or has expired/i);
  });

  it("checks the submitted token first, so a live new link wins over an old cookie", async () => {
    peekResetToken.mockResolvedValue(live());

    const res = await POST(
      postRequest({ token_hash: TOKEN, type: "recovery" }, { cookie: `litrack_reset=${EXISTING}` })
    );

    expect(peekResetToken).toHaveBeenCalledTimes(1);
    expect(peekResetToken).toHaveBeenCalledWith(TOKEN);
    expect(cookieOf(res, "litrack_reset")?.value).toBe(TOKEN);
  });
});
