import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_COOKIE_CACHE_SECONDS,
  SESSION_REFRESH_INTERVAL_MS,
  SESSION_REFRESH_PATH,
} from "@/lib/auth/auth-cookies";

/**
 * POST /api/session-refresh renews the Better Auth signed session cache.
 * RSC renders cannot write cookies, so this Route Handler forces a database
 * session read (`fresh: true`), which makes Better Auth re-issue the cookie.
 */

const getAuthSession = vi.fn();
vi.mock("@/lib/auth/auth-session", () => ({
  get getAuthSession() {
    return getAuthSession;
  },
}));

import * as route from "@/app/api/session-refresh/route";

function req(cookie?: string): Request {
  return new Request(`http://localhost${SESSION_REFRESH_PATH}`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

describe("session cache config", () => {
  it("keeps the 15-minute cache and renews before it expires", () => {
    expect(AUTH_COOKIE_CACHE_SECONDS).toBe(900);
    expect(SESSION_REFRESH_PATH).toBe("/api/session-refresh");
    expect(SESSION_REFRESH_INTERVAL_MS).toBeLessThan(AUTH_COOKIE_CACHE_SECONDS * 1000);
  });
});

describe("POST /api/session-refresh", () => {
  beforeEach(() => {
    getAuthSession.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("exports POST only and is force-dynamic", () => {
    expect(route.dynamic).toBe("force-dynamic");
    expect(typeof route.POST).toBe("function");
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });

  it("returns 204 without touching the database when there is no session cookie", async () => {
    const res = await route.POST(req());
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getAuthSession).not.toHaveBeenCalled();
  });

  it("forces a database-backed session read and returns 204 when the session exists", async () => {
    getAuthSession.mockResolvedValue({ session: {}, user: {} });
    const res = await route.POST(req("litrack.session_token=abc"));
    expect(res.status).toBe(204);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(getAuthSession).toHaveBeenCalledWith({ fresh: true });
  });

  it("also recognises the __Secure- cookie name", async () => {
    getAuthSession.mockResolvedValue({ session: {}, user: {} });
    const res = await route.POST(req("__Secure-litrack.session_token=abc"));
    expect(res.status).toBe(204);
    expect(getAuthSession).toHaveBeenCalledWith({ fresh: true });
  });

  it("returns 401 with no body when the session is gone", async () => {
    getAuthSession.mockResolvedValue(null);
    const res = await route.POST(req("litrack.session_token=abc"));
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  it("returns 503 without details when the read throws", async () => {
    getAuthSession.mockRejectedValue(new Error("db down: secret detail"));
    const res = await route.POST(req("litrack.session_token=abc"));
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });
});
