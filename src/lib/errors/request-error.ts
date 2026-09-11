import "server-only";
import type { Instrumentation } from "next";
import { classifyError } from "./classify";
import { reportError } from "./report";
import { authIdFromCookieHeader } from "./session-cookie";

/**
 * Uncaught errors from page renders, route handlers, middleware, and any server
 * action not yet wrapped by `action()` — which is why every module gets admin
 * visibility from this slice, before its own migration to the new system.
 *
 * The reference stored is Next's `digest`, which is exactly what `error.tsx`
 * shows the person, so the code they read off the screen finds the record.
 */

const CONTROL_FLOW =
  /^(?:NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING|NEXT_STATIC_GEN_BAILOUT)/;

export const reportRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  try {
    const digest =
      typeof (err as { digest?: unknown })?.digest === "string"
        ? (err as { digest: string }).digest
        : undefined;
    // `redirect()` and `notFound()` reach this hook as thrown control flow.
    // Recording them would bury real failures under every sign-in bounce.
    if (digest && CONTROL_FLOW.test(digest)) return;

    const appError = classifyError(err);
    // An expected refusal is already answered where it was thrown.
    if (appError.severity === "user") return;

    reportError(appError, {
      ref: digest,
      // The route PATTERN ("/teacher/learners/[id]"), never the URL, which
      // carries learner ids and whatever was typed into a search box.
      route: context.routePath,
      routeType: context.routeType,
      method: request.method,
      authId: authIdFromCookieHeader(request.headers.cookie),
      userSource: "cookie",
    });
  } catch (reportErr) {
    console.error(
      "[errors] onRequestError failed:",
      reportErr instanceof Error ? reportErr.message : reportErr
    );
  }
};
