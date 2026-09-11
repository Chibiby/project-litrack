import { describe, expect, it } from "vitest";
import { authIdFromCookieHeader } from "@/lib/errors/session-cookie";

/**
 * Reading the signed-in account out of the Supabase cookie, for attribution
 * only. @supabase/ssr has shipped several cookie shapes over the versions this
 * app has run, and a page-crash record should still name the person on any of
 * them — but must never fail loudly when it cannot.
 */

function jwt(payload: Record<string, unknown>): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part(payload)}.signature`;
}

function sessionCookie(authId: string): string {
  const session = { access_token: jwt({ sub: authId }), token_type: "bearer" };
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

describe("authIdFromCookieHeader", () => {
  it("reads the auth id out of a base64 session cookie", () => {
    const header = `theme=dark; sb-abcdefgh-auth-token=${sessionCookie("auth-123")}`;
    expect(authIdFromCookieHeader(header)).toBe("auth-123");
  });

  it("joins the chunks of a split cookie in order", () => {
    const whole = sessionCookie("auth-456");
    const half = Math.ceil(whole.length / 2);
    const header = `sb-abcdefgh-auth-token.0=${whole.slice(0, half)}; sb-abcdefgh-auth-token.1=${whole.slice(half)}`;
    expect(authIdFromCookieHeader(header)).toBe("auth-456");
  });

  it("reads the older raw-JSON and array cookie formats", () => {
    const raw = encodeURIComponent(JSON.stringify({ access_token: jwt({ sub: "auth-789" }) }));
    expect(authIdFromCookieHeader(`sb-x-auth-token=${raw}`)).toBe("auth-789");
    const arrayForm = encodeURIComponent(JSON.stringify([jwt({ sub: "auth-abc" }), "refresh"]));
    expect(authIdFromCookieHeader(`sb-x-auth-token=${arrayForm}`)).toBe("auth-abc");
  });

  it("returns null rather than throwing on anything unexpected", () => {
    expect(authIdFromCookieHeader(undefined)).toBeNull();
    expect(authIdFromCookieHeader("")).toBeNull();
    expect(authIdFromCookieHeader("sb-x-auth-token=not-base64-or-json")).toBeNull();
    expect(authIdFromCookieHeader("theme=dark")).toBeNull();
    expect(
      authIdFromCookieHeader(`sb-x-auth-token=base64-${Buffer.from("{}").toString("base64url")}`)
    ).toBeNull();
  });

  it("ignores the PKCE verifier cookie, which carries no session", () => {
    expect(authIdFromCookieHeader("sb-abcdefgh-auth-token-code-verifier=abc123")).toBeNull();
  });
});
