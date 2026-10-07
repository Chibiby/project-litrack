import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_COOKIE_CACHE_VERSION,
  authCookieName,
  authCookiesSecure,
  readEdgeSession,
} from "@/lib/auth/auth-cookies";
import { middleware } from "@/middleware";

/**
 * The Edge half of sign-in: middleware cannot reach the database, so it reads
 * the signed Better Auth cookie cache. These tests sign real cookies with the
 * same HMAC scheme `getCookieCache` verifies, so they exercise the library and
 * not a mock — a wrong prefix, version or secret fails here, the way it would
 * silently fail in production (risk R7).
 */

const SECRET = "test-secret-test-secret-test-secret-0123456789";

type CacheOptions = {
  role?: string;
  id?: string;
  secret?: string;
  version?: string;
  expiresInMs?: number;
  secure?: boolean;
  tamper?: boolean;
};

function cacheCookie(opts: CacheOptions = {}): string {
  const now = new Date().toISOString();
  const inner = {
    session: {
      id: "sess-1",
      userId: opts.id ?? "auth-1",
      token: "tok",
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
    user: {
      id: opts.id ?? "auth-1",
      email: "a@b.test",
      emailVerified: false,
      name: "",
      role: opts.role ?? "TEACHER",
      createdAt: now,
      updatedAt: now,
    },
    updatedAt: Date.now(),
    version: opts.version ?? AUTH_COOKIE_CACHE_VERSION,
  };
  const expiresAt = Date.now() + (opts.expiresInMs ?? 300_000);
  const signature = createHmac("sha256", opts.secret ?? SECRET)
    .update(JSON.stringify({ ...inner, expiresAt }))
    .digest("base64url");
  if (opts.tamper) inner.user.role = "SUPER_ADMIN";
  const value = Buffer.from(JSON.stringify({ session: inner, expiresAt, signature })).toString(
    "base64url"
  );
  const prefix = opts.secure ? "__Secure-" : "";
  return `${prefix}litrack.session_data=${value}`;
}

function headers(cookie: string): Headers {
  return new Headers({ cookie });
}

describe("authCookiesSecure / authCookieName", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("adds the __Secure- prefix only for an https app url", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://arallitrack.com");
    expect(authCookiesSecure()).toBe(true);
    expect(authCookieName("session_token")).toBe("__Secure-litrack.session_token");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    expect(authCookiesSecure()).toBe(false);
    expect(authCookieName("session_token")).toBe("litrack.session_token");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(authCookiesSecure()).toBe(false);
  });
});

describe("readEdgeSession", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("is null with no session token cookie, even if a cache cookie is present", async () => {
    expect(await readEdgeSession(headers("theme=dark"))).toBeNull();
    expect(await readEdgeSession(headers(cacheCookie()))).toBeNull();
  });

  it("reads id and role from a validly signed cache", async () => {
    const cookie = `litrack.session_token=tok.sig; ${cacheCookie({ role: "SCHOOL_HEAD", id: "auth-9" })}`;
    expect(await readEdgeSession(headers(cookie))).toEqual({ id: "auth-9", role: "SCHOOL_HEAD" });
  });

  it("accepts a Request as well as Headers", async () => {
    const cookie = `litrack.session_token=tok.sig; ${cacheCookie({ role: "DISTRICT_ADMIN" })}`;
    const req = new Request("https://x.test/", { headers: { cookie } });
    expect((await readEdgeSession(req))?.role).toBe("DISTRICT_ADMIN");
  });

  it("returns both fields null (pass through) when only the token cookie is present", async () => {
    expect(await readEdgeSession(headers("litrack.session_token=tok.sig"))).toEqual({
      id: null,
      role: null,
    });
  });

  it("does not trust a cache signed with another secret", async () => {
    const cookie = `litrack.session_token=t; ${cacheCookie({ secret: "some-other-secret-some-other-secret" })}`;
    expect(await readEdgeSession(headers(cookie))).toEqual({ id: null, role: null });
  });

  it("does not trust a cache whose payload was edited after signing (role escalation)", async () => {
    const cookie = `litrack.session_token=t; ${cacheCookie({ role: "TEACHER", tamper: true })}`;
    expect(await readEdgeSession(headers(cookie))).toEqual({ id: null, role: null });
  });

  it("ignores an expired cache", async () => {
    const cookie = `litrack.session_token=t; ${cacheCookie({ expiresInMs: -1000 })}`;
    expect(await readEdgeSession(headers(cookie))).toEqual({ id: null, role: null });
  });

  it("ignores a cache written under another cache version", async () => {
    const cookie = `litrack.session_token=t; ${cacheCookie({ version: "0" })}`;
    expect(await readEdgeSession(headers(cookie))).toEqual({ id: null, role: null });
  });

  it("maps an unknown role to null rather than inventing one", async () => {
    const cookie = `litrack.session_token=t; ${cacheCookie({ role: "PRINCIPAL" })}`;
    expect(await readEdgeSession(headers(cookie))).toEqual({ id: "auth-1", role: null });
  });

  it("degrades to role-unknown, never throws, when BETTER_AUTH_SECRET is missing", async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    const cookie = `litrack.session_token=t; ${cacheCookie()}`;
    await expect(readEdgeSession(headers(cookie))).resolves.toEqual({ id: null, role: null });
  });

  it("reads the __Secure- cookies when the app url is https, and not the plain ones", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://arallitrack.com");
    const secure = `__Secure-litrack.session_token=t; ${cacheCookie({ secure: true, role: "TEACHER" })}`;
    expect(await readEdgeSession(headers(secure))).toEqual({ id: "auth-1", role: "TEACHER" });
    // Same cookies without the prefix: the middleware is looking for the wrong
    // names, so the role stays unknown (the R7 failure mode, pinned).
    const plain = `litrack.session_token=t; ${cacheCookie({ role: "TEACHER" })}`;
    expect((await readEdgeSession(headers(plain)))?.role).toBeNull();
  });
});

describe("middleware over the Better Auth cookies", () => {
  beforeEach(() => {
    vi.stubEnv("BETTER_AUTH_SECRET", SECRET);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  });
  afterEach(() => vi.unstubAllEnvs());

  function req(path: string, cookie?: string, method = "GET") {
    return new NextRequest(`https://litrack.test${path}`, {
      method,
      headers: cookie ? { cookie } : {},
    });
  }
  const signedIn = (role: string) => `litrack.session_token=t; ${cacheCookie({ role })}`;
  const location = (res: Response) => res.headers.get("location");

  it("sends a signed-out visitor to the school login, or the admin login for admin areas", async () => {
    expect(new URL(location(await middleware(req("/teacher")))!).pathname + "").toBe("/login");
    expect(new URL(location(await middleware(req("/admin")))!).pathname).toBe("/admin/login");
    expect(new URL(location(await middleware(req("/district")))!).pathname).toBe("/admin/login");
  });

  it("says the session expired when a session cookie existed but no role is readable", async () => {
    // Token cookie only (cache expired): no role, so the request passes to requireUser.
    const res = await middleware(req("/teacher", "litrack.session_token=t"));
    expect(location(res)).toBeNull();
  });

  it("flags a leftover Supabase session as an expired session and expires its cookies", async () => {
    const res = await middleware(req("/teacher", "sb-abc-auth-token=x; sb-abc-auth-token-code-verifier=y"));
    const target = new URL(location(res)!);
    expect(target.pathname + target.search).toBe("/login?reason=session_expired");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("sb-abc-auth-token=;");
    expect(setCookie).toContain("sb-abc-auth-token-code-verifier=;");
  });

  it("keeps each role out of the other roles' areas using the signed role", async () => {
    expect(new URL(location(await middleware(req("/admin", signedIn("TEACHER"))))!).pathname).toBe("/teacher");
    expect(new URL(location(await middleware(req("/teacher", signedIn("SCHOOL_HEAD"))))!).pathname).toBe(
      "/school-head"
    );
    expect(location(await middleware(req("/teacher", signedIn("TEACHER"))))).toBeNull();
    expect(location(await middleware(req("/teacher", signedIn("SUPER_ADMIN"))))).toBeNull();
  });

  it("bounces a signed-in visitor off the login page, but lets a Server Action POST through", async () => {
    expect(new URL(location(await middleware(req("/login", signedIn("TEACHER"))))!).pathname).toBe("/teacher");
    expect(location(await middleware(req("/login", signedIn("TEACHER"), "POST")))).toBeNull();
  });

  it("ignores a forged role: a tampered cache gets no redirect decision from it", async () => {
    const forged = `litrack.session_token=t; ${cacheCookie({ role: "TEACHER", tamper: true })}`;
    // Role unknown, so the prefix check passes through; requireUser decides.
    expect(location(await middleware(req("/admin", forged)))).toBeNull();
  });

  it("does no session work for /api", async () => {
    expect(location(await middleware(req("/api/schools/list")))).toBeNull();
  });
});
