import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The API-route wrapper. One JSON shape for every failure, and — because the
 * backup-download link is opened by a browser, not by fetch — a redirect to the
 * right page rather than raw JSON when a person is looking at it.
 */

const reportError = vi.fn(() => "E-TESTREF2");
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));

import { NextRequest, NextResponse } from "next/server";
import { AppError, tooManyAttempts } from "@/lib/errors/app-error";
import { route } from "@/lib/errors/route";

function request(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(new URL(url, "https://litrack.example.org"), { headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  reportError.mockReturnValue("E-TESTREF2");
});

describe("route()", () => {
  it("passes a successful response through", async () => {
    const handler = route("GET /api/x", async () => NextResponse.json({ ok: true }));
    const res = await handler(request("/api/x"));
    expect(res.status).toBe(200);
  });

  it("answers a refused request with the house JSON shape", async () => {
    const handler = route("GET /api/x", async () => {
      throw new AppError("AUTH_FORBIDDEN");
    });
    const res = await handler(request("/api/x"));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      code: "AUTH_FORBIDDEN",
      message: "You don't have access to this.",
      status: 403,
    });
  });

  it("adds a reference for an unexpected failure, and never the raw text", async () => {
    const handler = route("GET /api/x", async () => {
      throw new Error("kaboom");
    });
    const res = await handler(request("/api/x"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ code: "INTERNAL_ERROR", ref: "E-TESTREF2" });
    expect(body.message).not.toContain("kaboom");
  });

  it("sets Retry-After when the limiter says how long", async () => {
    const handler = route("GET /api/x", async () => {
      throw tooManyAttempts(30_000, "RATE_LIMITED");
    });
    const res = await handler(request("/api/x"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("sends a browser to the right page instead of raw JSON", async () => {
    const html = { accept: "text/html,application/xhtml+xml" };
    const forbidden = await route("GET /api/admin/x", async () => {
      throw new AppError("AUTH_FORBIDDEN");
    })(request("/api/admin/x", html));
    expect(forbidden.status).toBe(303);
    expect(forbidden.headers.get("location")).toContain("/forbidden");

    const signedOut = await route("GET /api/admin/x", async () => {
      throw new AppError("AUTH_NOT_SIGNED_IN");
    })(request("/api/admin/x", html));
    expect(signedOut.headers.get("location")).toContain("/admin/login");
  });

  it("still answers fetch with JSON, even for the same refusal", async () => {
    const res = await route("GET /api/admin/x", async () => {
      throw new AppError("AUTH_FORBIDDEN");
    })(request("/api/admin/x", { accept: "application/json" }));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "AUTH_FORBIDDEN" });
  });
});
