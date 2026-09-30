import { classifyClientFailure, isNextControlFlow } from "@/lib/errors/client";
import { formatMessage } from "@/lib/errors/codes";
import type { ActionFailure } from "@/lib/errors/result";

/**
 * Call a server action and turn a request that failed without a normal result
 * (offline, dropped connection, app updated mid-session, crash) into an
 * `ActionFailure`, so the caller has one branch to handle.
 *
 * Offline is answered before sending: the request would only hang or fail, and
 * the person should learn that immediately. Redirects are not failures — the
 * router has already navigated — so they are rethrown untouched.
 *
 * Does not toast; callers already toast `res.error`.
 *
 * @example
 * const res = await callAction(() => saveThing(formData));
 * if (!res.ok) {
 *   toast.error(res.error);
 *   return;
 * }
 */
export async function callAction<R>(
  run: () => Promise<R>
): Promise<R | ActionFailure> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return {
      ok: false,
      code: "NETWORK_OFFLINE",
      error: formatMessage("NETWORK_OFFLINE"),
    };
  }
  try {
    return await run();
  } catch (err) {
    if (isNextControlFlow(err)) throw err;
    return classifyClientFailure(err);
  }
}
