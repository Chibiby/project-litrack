/**
 * Supabase Auth failures → catalog codes. Isomorphic: the login form classifies
 * the browser's password grant with the same function the server uses.
 *
 * Code first (supabase-js puts a machine-readable `code` on AuthApiError), then
 * the documented messages for older auth servers that send none. Anything not
 * recognized is AUTH_PROVIDER_ERROR — never "incorrect password", which is the
 * guess that sent schools off resetting passwords that were fine.
 */

import { isAuthRateLimitError } from "@/lib/auth/auth-errors";
import type { ErrorCode } from "./codes";

type Side = "browser" | "server";

type AuthErrorLike = { name?: unknown; status?: unknown; code?: unknown; message?: unknown };

function asAuthError(err: unknown): AuthErrorLike | null {
  return err && typeof err === "object" ? (err as AuthErrorLike) : null;
}

/** The request never got a real answer: network, DNS, or the auth server itself. */
export function isAuthServiceUnreachable(err: unknown): boolean {
  const e = asAuthError(err);
  if (!e) return false;
  if (e.name === "AuthRetryableFetchError") return true;
  if (typeof e.status === "number" && (e.status === 0 || e.status >= 500)) return true;
  return (
    typeof e.message === "string" &&
    /failed to fetch|fetch failed|networkerror|load failed/i.test(e.message)
  );
}

const BY_CODE: Record<string, ErrorCode> = {
  invalid_credentials: "AUTH_INCORRECT_PASSWORD",
  same_password: "AUTH_PASSWORD_SAME",
  weak_password: "AUTH_PASSWORD_WEAK",
  signup_disabled: "AUTH_SIGNUPS_DISABLED",
  email_address_invalid: "AUTH_EMAIL_REJECTED",
  email_exists: "AUTH_EMAIL_IN_USE",
  user_already_exists: "AUTH_EMAIL_IN_USE",
  session_not_found: "AUTH_SESSION_EXPIRED",
  session_expired: "AUTH_SESSION_EXPIRED",
  refresh_token_not_found: "AUTH_SESSION_EXPIRED",
  refresh_token_already_used: "AUTH_SESSION_EXPIRED",
};

const BY_MESSAGE: Array<[RegExp, ErrorCode]> = [
  [/invalid login credentials/i, "AUTH_INCORRECT_PASSWORD"],
  [/should be different from the old password/i, "AUTH_PASSWORD_SAME"],
  [/password should (?:be|contain)/i, "AUTH_PASSWORD_WEAK"],
  [/signups? not allowed/i, "AUTH_SIGNUPS_DISABLED"],
  [/already (?:been )?registered|already exists/i, "AUTH_EMAIL_IN_USE"],
  [/error sending|smtp/i, "AUTH_EMAIL_SEND_FAILED"],
];

export function mapSupabaseAuthError(err: unknown, side: Side): ErrorCode {
  const e = asAuthError(err);
  if (!e) return "AUTH_PROVIDER_ERROR";
  if (isAuthRateLimitError(err)) return "AUTH_PROVIDER_RATE_LIMITED";
  if (isAuthServiceUnreachable(err)) {
    // From the browser it is usually the person's connection. From our server
    // it is our infrastructure, and the connection advice would be wrong.
    return side === "browser" ? "AUTH_SERVICE_UNREACHABLE" : "AUTH_PROVIDER_ERROR";
  }
  if (typeof e.code === "string" && Object.hasOwn(BY_CODE, e.code)) return BY_CODE[e.code];
  if (typeof e.message === "string") {
    for (const [pattern, code] of BY_MESSAGE) if (pattern.test(e.message)) return code;
  }
  return "AUTH_PROVIDER_ERROR";
}

/** Audit `reason` values. The first two predate this module and must not change. */
export type LoginFailureReason =
  | "incorrect_credentials"
  | "rate_limited"
  | "service_unreachable"
  | "provider_error";

export const LOGIN_FAILURE_REASONS: readonly LoginFailureReason[] = [
  "incorrect_credentials",
  "rate_limited",
  "service_unreachable",
  "provider_error",
];

export function loginFailureReasonFor(code: ErrorCode): LoginFailureReason {
  switch (code) {
    case "AUTH_INCORRECT_PASSWORD":
    case "AUTH_INCORRECT_CREDENTIALS":
      return "incorrect_credentials";
    case "AUTH_PROVIDER_RATE_LIMITED":
      return "rate_limited";
    case "AUTH_SERVICE_UNREACHABLE":
      return "service_unreachable";
    default:
      return "provider_error";
  }
}
