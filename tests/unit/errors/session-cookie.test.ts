import { describe, expect, it } from "vitest";
import { authIdFromCookieHeader } from "@/lib/errors/session-cookie";

/**
 * Reading the signed-in account out of the Better Auth session cache cookie,
 * for attribution only (the signature is deliberately not verified here). A
 * page-crash record should name the person when it can — and must never fail
 * loudly when it cannot.
 */

function sessionData(authId: unknown): string {
  const data = {
    session: { session: { id: "s1" }, user: { id: authId, role: "TEACHER" } },
    expiresAt: Date.now() + 300_000,
    signature: "sig",
  };
  return Buffer.from(JSON.stringify(data)).toString("base64url");
}

describe("authIdFromCookieHeader", () => {
  it("reads the auth id out of the session cache cookie", () => {
    const header = `theme=dark; litrack.session_data=${sessionData("auth-123")}`;
    expect(authIdFromCookieHeader(header)).toBe("auth-123");
  });

  it("reads the __Secure- prefixed cookie used on https", () => {
    expect(authIdFromCookieHeader(`__Secure-litrack.session_data=${sessionData("auth-456")}`)).toBe(
      "auth-456"
    );
  });

  it("accepts a url-encoded cookie value and a header array", () => {
    const encoded = encodeURIComponent(sessionData("auth-789"));
    expect(authIdFromCookieHeader([`theme=dark`, `litrack.session_data=${encoded}`])).toBe("auth-789");
  });

  it("returns null rather than throwing on anything unexpected", () => {
    expect(authIdFromCookieHeader(undefined)).toBeNull();
    expect(authIdFromCookieHeader("")).toBeNull();
    expect(authIdFromCookieHeader("litrack.session_data=not-base64-or-json")).toBeNull();
    expect(authIdFromCookieHeader("litrack.session_data=")).toBeNull();
    expect(authIdFromCookieHeader("theme=dark")).toBeNull();
    expect(authIdFromCookieHeader(`litrack.session_data=${sessionData(42)}`)).toBeNull();
    expect(authIdFromCookieHeader(`litrack.session_data=${sessionData("")}`)).toBeNull();
    expect(
      authIdFromCookieHeader(`litrack.session_data=${Buffer.from("{}").toString("base64url")}`)
    ).toBeNull();
  });

  it("ignores the session token cookie and any Supabase cookie, which carry no readable id", () => {
    expect(authIdFromCookieHeader("litrack.session_token=abc.def")).toBeNull();
    expect(authIdFromCookieHeader("sb-abcdefgh-auth-token=base64-e30")).toBeNull();
  });
});
