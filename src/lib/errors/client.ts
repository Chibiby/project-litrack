import { unstable_isUnrecognizedActionError } from "next/navigation";
import { formatMessage, withReference, type ErrorCode } from "./codes";
import type { ActionFailure } from "./result";

/**
 * What the browser makes of a request that failed without a normal result:
 * offline, a deploy that outdated this page, a dropped connection, a crashed
 * action. Isomorphic and free of React, so any caller (and the tests) can use it.
 *
 * Raw error text is never passed through. A proxy's text/plain body can become
 * an Error message, and it may name tables or hosts.
 */

/** Both shapes reject the client promise even though the router already acted. */
const REDIRECT_DIGEST = "NEXT_REDIRECT";
const HTTP_FALLBACK_DIGEST = "NEXT_HTTP_ERROR_FALLBACK";

function digestOf(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("digest" in err)) return undefined;
  const { digest } = err as { digest: unknown };
  return typeof digest === "string" ? digest : undefined;
}

/**
 * True for redirect / notFound / forbidden / unauthorized thrown values.
 *
 * A `redirect()` inside a server action rejects the client promise after the
 * router has already navigated, so callers must check this first and rethrow or
 * ignore — never classify or toast it. Digest checks rather than
 * `unstable_rethrow`, which has a different implementation per runtime.
 */
export function isNextControlFlow(err: unknown): boolean {
  const digest = digestOf(err);
  if (!digest) return false;
  const [prefix, second] = digest.split(";");
  if (prefix === REDIRECT_DIGEST) return second === "replace" || second === "push";
  return prefix === HTTP_FALLBACK_DIGEST && ["401", "403", "404"].includes(second ?? "");
}

/** `code` is optional so older `{ ok: false, error }` results still match. */
export function isActionFailure(value: unknown): value is ActionFailure {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { ok?: unknown }).ok === false &&
    typeof (value as { error?: unknown }).error === "string"
  );
}

function failure(code: ErrorCode, ref?: string): ActionFailure {
  const result: ActionFailure = {
    ok: false,
    code,
    error: withReference(formatMessage(code), ref),
  };
  if (ref) result.ref = ref;
  return result;
}

const DEPLOY_SKEW_MESSAGE =
  /Loading chunk [\w-]+ failed|Failed to load chunk|Failed to fetch dynamically imported module|error loading dynamically imported module/i;
const NETWORK_MESSAGE =
  /failed to fetch|fetch failed|networkerror|load failed|network connection was lost/i;

/** Next's internal code for the request-body size ApiError(413). Best effort. */
const BODY_TOO_LARGE_SUFFIX = "@E394";

/**
 * Turn anything thrown by a request into a safe `ActionFailure`.
 *
 * Does NOT handle control flow: callers check `isNextControlFlow(err)` first.
 *
 * A server digest proves the server answered, so `trustDigestWhenOffline` lets a
 * caller that renders an already-received error skip the offline shortcut.
 */
export function classifyClientFailure(
  err: unknown,
  opts?: { trustDigestWhenOffline?: boolean }
): ActionFailure {
  const skipOffline = opts?.trustDigestWhenOffline === true && digestOf(err) !== undefined;
  if (!skipOffline && typeof navigator !== "undefined" && navigator.onLine === false) {
    return failure("NETWORK_OFFLINE");
  }

  const name = err instanceof Error ? err.name : undefined;
  const message = err instanceof Error ? err.message : "";

  if (
    unstable_isUnrecognizedActionError(err) ||
    name === "ChunkLoadError" ||
    DEPLOY_SKEW_MESSAGE.test(message)
  ) {
    return failure("APP_UPDATED");
  }

  if (name === "TypeError" && NETWORK_MESSAGE.test(message)) {
    return failure("SERVER_UNREACHABLE");
  }

  const digest = digestOf(err);
  if (digest) {
    if (digest.startsWith("DBU-")) return failure("DB_UNAVAILABLE", digest);
    if (digest.startsWith("DBS-")) return failure("DB_SCHEMA_OUT_OF_DATE", digest);
    if (digest.endsWith(BODY_TOO_LARGE_SUFFIX)) return failure("REQUEST_TOO_LARGE");
    return failure("INTERNAL_ERROR", digest);
  }

  if (message === "An unexpected response was received from the server.") {
    return failure("SERVER_UNREACHABLE");
  }

  return failure("INTERNAL_ERROR");
}
