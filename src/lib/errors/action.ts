import "server-only";
import { unstable_rethrow } from "next/navigation";
import { classifyError } from "./classify";
import { runInErrorScope } from "./context";
import { reportError } from "./report";
import { toFailure, type ActionFailure } from "./result";

/**
 * The single handler for server actions.
 *
 * Wrap each action once and let the body throw `AppError` instead of building
 * `{ ok: false, error }` by hand. Anything else that escapes — Prisma, Supabase,
 * a bug — is classified, recorded for admins, and answered with a message that
 * is safe to show.
 *
 * `unstable_rethrow` runs FIRST and is not optional: `redirect()` and
 * `notFound()` work by throwing, `requireUser` uses both, and swallowing them
 * here would turn every sign-in redirect into a silent failure.
 */

export type ActionOptions = {
  /** Completes "Couldn't {verb}" in database messages, e.g. "save the section". */
  verb?: string;
};

export function action<Args extends unknown[], R>(
  name: string,
  fn: (...args: Args) => Promise<R>,
  options: ActionOptions = {}
): (...args: Args) => Promise<R | ActionFailure> {
  return async (...args: Args): Promise<R | ActionFailure> =>
    runInErrorScope(name, async () => {
      try {
        return await fn(...args);
      } catch (err) {
        unstable_rethrow(err);
        const appError = classifyError(err, { verb: options.verb });
        if (appError.severity === "user") return toFailure(appError);
        const ref = reportError(appError, { route: name, routeType: "action" });
        // Only a failure on our side earns a reference: it is the code an admin
        // can look up. A refusal or a rate limit is recorded without one — the
        // person cannot act on it, and it would read as an invitation to report.
        return toFailure(appError, appError.severity === "system" ? ref : undefined);
      }
    });
}
