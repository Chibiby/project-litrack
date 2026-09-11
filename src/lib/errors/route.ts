import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { unstable_rethrow } from "next/navigation";
import { withReference } from "./codes";
import type { AppError } from "./app-error";
import { classifyError } from "./classify";
import { runInErrorScope } from "./context";
import { reportError } from "./report";

/** The same handler as `action()`, for the API routes. */

type RouteHandler = (request: NextRequest) => Promise<Response>;

export function errorResponse(request: NextRequest, err: AppError, ref?: string): Response {
  // A download link opened in a browser should land on a page, not on JSON.
  const accept = request.headers.get("accept") ?? "";
  if (accept.includes("text/html") && (err.status === 401 || err.status === 403)) {
    const target =
      err.status === 403
        ? "/forbidden"
        : request.nextUrl.pathname.startsWith("/api/admin")
          ? "/admin/login"
          : "/login";
    return NextResponse.redirect(new URL(target, request.url), 303);
  }

  const headers = new Headers();
  const retryAfter = err.context.retryAfterSeconds;
  if (typeof retryAfter === "number") {
    headers.set("Retry-After", String(Math.max(1, retryAfter)));
  }

  return NextResponse.json(
    {
      code: err.code,
      message: withReference(err.message, ref),
      status: err.status,
      ...(ref ? { ref } : {}),
    },
    { status: err.status, headers }
  );
}

export function route(name: string, handler: RouteHandler): RouteHandler {
  return async (request: NextRequest): Promise<Response> =>
    runInErrorScope(name, async () => {
      try {
        return await handler(request);
      } catch (err) {
        unstable_rethrow(err);
        const appError = classifyError(err);
        if (appError.severity === "user") return errorResponse(request, appError);
        const ref = reportError(appError, {
          route: name,
          routeType: "route",
          method: request.method,
        });
        return errorResponse(request, appError, appError.severity === "system" ? ref : undefined);
      }
    });
}
