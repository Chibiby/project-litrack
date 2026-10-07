/**
 * Better Auth failures → catalog codes.
 *
 * Structural, with no import from `better-auth`: Better Auth's `APIError`
 * (better-call) has `name === "APIError"`, a numeric `statusCode`, and a
 * `body.code` from its error-code tables (`INVALID_EMAIL_OR_PASSWORD`, …).
 * Checking the shape keeps this module dependency-free and isomorphic, like
 * the module it replaces, so the error classifier can import it anywhere.
 *
 * Code first, then the HTTP status. Anything not recognized is
 * AUTH_PROVIDER_ERROR — never "incorrect password", which is the guess that
 * sent schools off resetting passwords that were fine.
 */

import type { ErrorCode } from "./codes";

export type AuthApiErrorLike = {
  name: "APIError";
  statusCode: number;
  status?: unknown;
  body?: { code?: unknown; message?: unknown } | undefined;
  message?: unknown;
};

/** A refusal Better Auth answered with (any HTTP status), as opposed to a crash. */
export function isAuthApiError(err: unknown): err is AuthApiErrorLike {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: unknown; statusCode?: unknown };
  return e.name === "APIError" && typeof e.statusCode === "number";
}

/** The machine-readable code on a Better Auth error, or null. */
export function authErrorCode(err: unknown): string | null {
  if (!isAuthApiError(err)) return null;
  const code = err.body?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

const BY_CODE: Record<string, ErrorCode> = {
  INVALID_EMAIL_OR_PASSWORD: "AUTH_INCORRECT_PASSWORD",
  INVALID_PASSWORD: "AUTH_INCORRECT_PASSWORD",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "AUTH_INCORRECT_PASSWORD",
  INVALID_EMAIL: "AUTH_EMAIL_REJECTED",
  PASSWORD_TOO_SHORT: "AUTH_PASSWORD_WEAK",
  PASSWORD_TOO_LONG: "AUTH_PASSWORD_WEAK",
  USER_ALREADY_EXISTS: "AUTH_EMAIL_IN_USE",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "AUTH_EMAIL_IN_USE",
  EMAIL_PASSWORD_DISABLED: "AUTH_SIGNUPS_DISABLED",
  EMAIL_PASSWORD_SIGN_UP_DISABLED: "AUTH_SIGNUPS_DISABLED",
  SESSION_EXPIRED: "AUTH_SESSION_EXPIRED",
  INVALID_TOKEN: "AUTH_RESET_LINK_EXPIRED",
  TOKEN_EXPIRED: "AUTH_RESET_LINK_EXPIRED",
  BANNED_USER: "AUTH_ACCOUNT_DISABLED",
  USER_NOT_FOUND: "IDENTITY_NOT_FOUND",
  YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS: "AUTH_FORBIDDEN",
  YOU_CANNOT_IMPERSONATE_ADMINS: "AUTH_FORBIDDEN",
};

/**
 * The catalog code for an auth failure. A non-Better-Auth value is
 * AUTH_PROVIDER_ERROR: the caller only asks this about errors from an auth
 * call, and an unknown one is our infrastructure, not the person's mistake.
 */
export function mapAuthError(err: unknown): ErrorCode {
  if (!isAuthApiError(err)) return "AUTH_PROVIDER_ERROR";
  const code = authErrorCode(err);
  // getSession answers FAILED_TO_GET_SESSION with 401 for a session that is
  // gone, and with 500 when reading it crashed (the database being down).
  // Only the 401 is the person's session ending; the 500 is ours and must be
  // a system-severity code so it is recorded, never "your session ended".
  if (code === "FAILED_TO_GET_SESSION") {
    return err.statusCode === 401 ? "AUTH_SESSION_EXPIRED" : "AUTH_PROVIDER_ERROR";
  }
  if (code && Object.hasOwn(BY_CODE, code)) return BY_CODE[code];
  if (err.statusCode === 429) return "AUTH_PROVIDER_RATE_LIMITED";
  if (err.statusCode === 401 && !code) return "AUTH_SESSION_EXPIRED";
  return "AUTH_PROVIDER_ERROR";
}

// ── Shared helpers (carried over from the previous auth provider's error module) ──

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
