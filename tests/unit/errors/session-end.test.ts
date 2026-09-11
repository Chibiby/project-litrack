import { describe, expect, it } from "vitest";
import { hasSupabaseSessionCookie, loginPath, sessionEndCode } from "@/lib/auth/session-end";

/**
 * The login page used to render `?error=<anything>` into a toast, so a crafted
 * link could put any sentence on the real sign-in screen — a support number to
 * call, for instance. The allow-list below is what ends that: a token names a
 * message, and nothing from the URL is ever displayed.
 */

describe("sessionEndCode", () => {
  it("maps each known reason to a catalog code", () => {
    expect(sessionEndCode("session_expired")).toBe("AUTH_SESSION_EXPIRED");
    expect(sessionEndCode("account_disabled")).toBe("AUTH_ACCOUNT_DISABLED");
    expect(sessionEndCode("declined")).toBe("AUTH_REGISTRATION_DECLINED");
    expect(sessionEndCode("deactivated")).toBe("AUTH_ACCOUNT_DEACTIVATED");
  });

  it("refuses anything else, so no text from a URL is ever shown", () => {
    expect(sessionEndCode("Your account was hacked, call 0917-000-0000")).toBeNull();
    expect(sessionEndCode("__proto__")).toBeNull();
    expect(sessionEndCode("toString")).toBeNull();
    expect(sessionEndCode(undefined)).toBeNull();
    expect(sessionEndCode(["session_expired"])).toBeNull();
  });
});

describe("loginPath", () => {
  it("sends admins to the admin login and everyone else to the school login", () => {
    expect(loginPath("admin")).toBe("/admin/login");
    expect(loginPath("school")).toBe("/login");
  });

  it("carries the reason as a short token, never as a message", () => {
    expect(loginPath("school", "session_expired")).toBe("/login?reason=session_expired");
    expect(loginPath("admin", "account_disabled")).toBe("/admin/login?reason=account_disabled");
    expect(loginPath("school", null)).toBe("/login");
  });
});

describe("hasSupabaseSessionCookie", () => {
  it("recognizes whole and chunked session cookies", () => {
    expect(hasSupabaseSessionCookie(["theme", "sb-abcdef-auth-token"])).toBe(true);
    expect(hasSupabaseSessionCookie(["sb-abcdef-auth-token.1"])).toBe(true);
  });

  it("ignores other cookies, including Supabase's non-session ones", () => {
    expect(hasSupabaseSessionCookie(["theme", "litrack-sidebar"])).toBe(false);
    expect(hasSupabaseSessionCookie(["sb-abcdef-auth-token-code-verifier"])).toBe(false);
    expect(hasSupabaseSessionCookie([])).toBe(false);
  });
});
