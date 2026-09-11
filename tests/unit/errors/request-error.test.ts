import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The hook that catches everything `action()` does not: crashed renders, route
 * handlers, middleware, and every action module not yet migrated.
 *
 * Two properties carry it. It files under Next's digest, which is the same
 * string `error.tsx` shows the person — so a code read off a screen finds the
 * record. And it ignores Next's control flow, which arrives here as thrown
 * errors; recording those would bury real failures under every sign-in bounce.
 */

const reportError = vi.fn(() => "E-IGNORED");
vi.mock("@/lib/errors/report", () => ({
  get reportError() {
    return reportError;
  },
}));

import { reportRequestError } from "@/lib/errors/request-error";

const REQUEST = {
  path: "/teacher/learners/abc?q=maria",
  method: "GET",
  headers: {} as Record<string, string>,
};
const CONTEXT = {
  routerKind: "App Router" as const,
  routePath: "/teacher/learners/[id]",
  routeType: "render" as const,
  revalidateReason: undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("reportRequestError", () => {
  it("records a crashed render under the route pattern, using Next's digest as the reference", async () => {
    const err = Object.assign(new Error("boom"), { digest: "2847562910" });
    await reportRequestError(err, REQUEST, CONTEXT);
    expect(reportError).toHaveBeenCalledTimes(1);
    const [appError, input] = reportError.mock.calls[0];
    expect(appError).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(input).toMatchObject({
      ref: "2847562910",
      route: "/teacher/learners/[id]",
      routeType: "render",
      method: "GET",
    });
  });

  it("stores the route pattern, never the URL with its values", async () => {
    await reportRequestError(new Error("boom"), REQUEST, CONTEXT);
    expect(JSON.stringify(reportError.mock.calls[0][1])).not.toContain("maria");
  });

  it("ignores Next's control flow", async () => {
    for (const digest of [
      "NEXT_REDIRECT;replace;/login;307;",
      "NEXT_HTTP_ERROR_FALLBACK;404",
      "DYNAMIC_SERVER_USAGE",
    ]) {
      await reportRequestError(Object.assign(new Error("control"), { digest }), REQUEST, CONTEXT);
    }
    expect(reportError).not.toHaveBeenCalled();
  });

  it("ignores an expected refusal that reached the boundary", async () => {
    const { AppError } = await import("@/lib/errors/app-error");
    await reportRequestError(new AppError("AUTH_SESSION_EXPIRED"), REQUEST, CONTEXT);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("attributes the error to the signed-in account when the cookie says who", async () => {
    const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const token = `${part({ alg: "HS256" })}.${part({ sub: "auth-42" })}.sig`;
    const cookie = `sb-proj-auth-token=base64-${Buffer.from(
      JSON.stringify({ access_token: token })
    ).toString("base64url")}`;
    await reportRequestError(new Error("boom"), { ...REQUEST, headers: { cookie } }, CONTEXT);
    expect(reportError.mock.calls[0][1]).toMatchObject({
      authId: "auth-42",
      userSource: "cookie",
    });
  });

  it("never throws, even when reporting itself is broken", async () => {
    reportError.mockImplementation(() => {
      throw new Error("reporting is broken");
    });
    await expect(reportRequestError(new Error("boom"), REQUEST, CONTEXT)).resolves.toBeUndefined();
  });
});
