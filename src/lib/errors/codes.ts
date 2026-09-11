/**
 * Every error LITRACK can show a person, in one place.
 *
 * Pure and dependency-free, so the browser (the login form) and the server share
 * one list. Messages are plain strings with {placeholders}, never functions, so
 * this file can be handed to a translator as it is.
 *
 * Severity decides where an error is recorded, not how it reads:
 *   user     — an expected mistake the person can fix. Not recorded as an error
 *              (sign-in outcomes still go to AuditLog).
 *   security — someone was refused: access, a rate limit, another school's row.
 *              Recorded in ErrorEvent.
 *   system   — something on our side failed. Recorded, eligible for an alert
 *              email, and the person gets a reference to quote.
 *
 * Adding a code: see docs/errors.md.
 */

export type ErrorSeverity = "user" | "security" | "system";

export type ErrorDefinition = {
  status: number;
  severity: ErrorSeverity;
  message: string;
};

export type ErrorParams = Record<string, string | number>;

export const ERRORS = {
  // ── Sign-in ──────────────────────────────────────────────────────────────
  AUTH_INCORRECT_PASSWORD: {
    status: 401,
    severity: "user",
    message: "Incorrect password. Check it and try again.",
  },
  AUTH_INCORRECT_CREDENTIALS: {
    status: 401,
    severity: "user",
    message: "Incorrect username or password.",
  },
  AUTH_TEACHER_NOT_FOUND: {
    status: 404,
    severity: "user",
    message:
      "No teacher account uses this email at the selected school. Check the email and school, or create an account.",
  },
  AUTH_NO_SCHOOL_HEAD_ACCOUNT: {
    status: 404,
    severity: "security",
    message:
      "This school doesn't have a School Head account yet. Contact your division office to set one up.",
  },
  AUTH_SCHOOL_INACTIVE: {
    status: 403,
    severity: "user",
    message: "This school's LITRACK access is turned off. Contact your division office.",
  },
  AUTH_TOO_MANY_ATTEMPTS: {
    status: 429,
    severity: "security",
    message: "Too many attempts. Try again in {wait}.",
  },
  AUTH_PROVIDER_RATE_LIMITED: {
    status: 429,
    severity: "security",
    message:
      "Too many sign-in attempts right now. Wait about five minutes and try again — your password has not changed, so there is no need to reset it.",
  },
  AUTH_SERVICE_UNREACHABLE: {
    status: 503,
    severity: "user",
    message: "Couldn't reach the sign-in service. Check your internet connection and try again.",
  },
  AUTH_PROVIDER_ERROR: {
    status: 502,
    severity: "system",
    message: "The sign-in service couldn't finish this request. Try again in a few minutes.",
  },
  AUTH_ACCOUNT_DEACTIVATED: {
    status: 403,
    severity: "user",
    message: "Your account has been deactivated. Contact your School Head.",
  },
  AUTH_REGISTRATION_DECLINED: {
    status: 403,
    severity: "user",
    message: "Your registration was declined. Contact your School Head.",
  },
  AUTH_TEACHER_PENDING: {
    status: 409,
    severity: "user",
    message: "Your request is pending School Head approval.",
  },
  AUTH_ACCOUNT_DISABLED: {
    status: 403,
    severity: "user",
    message: "This account has been turned off. Contact your division office.",
  },
  AUTH_SESSION_EXPIRED: {
    status: 401,
    severity: "user",
    message: "Your session ended. Sign in again to continue.",
  },
  AUTH_NOT_SIGNED_IN: {
    status: 401,
    severity: "user",
    message: "Sign in to continue.",
  },
  AUTH_FORBIDDEN: {
    status: 403,
    severity: "security",
    message: "You don't have access to {what}.",
  },
  AUTH_RESET_LINK_EXPIRED: {
    status: 401,
    severity: "user",
    message: "This reset link has expired or was already used. Request a new one.",
  },
  AUTH_CURRENT_PASSWORD_INCORRECT: {
    status: 401,
    severity: "user",
    message: "Your current password is incorrect.",
  },
  AUTH_PASSWORD_SAME: {
    status: 422,
    severity: "user",
    message: "Your new password must be different from your current one.",
  },
  AUTH_PASSWORD_WEAK: {
    status: 422,
    severity: "user",
    message:
      "That password is too easy to guess. Use a longer one with a mix of letters and numbers.",
  },
  AUTH_EMAIL_UNCHANGED: {
    status: 422,
    severity: "user",
    message: "The new email is the same as your current one.",
  },
  AUTH_EMAIL_IN_USE: {
    status: 409,
    severity: "user",
    message: "That email is already used by another LITRACK account.",
  },
  AUTH_ACCOUNT_EXISTS_SIGN_IN: {
    status: 409,
    severity: "user",
    message:
      "That email already has an account. Sign in instead, or use Forgot password to reset it.",
  },
  AUTH_REGISTERED_SIGN_IN: {
    status: 409,
    severity: "user",
    message: "Your account was created. Sign in with your email and password.",
  },
  AUTH_SIGNUPS_DISABLED: {
    status: 503,
    severity: "system",
    message: "New accounts can't be created right now. Contact your School Head.",
  },
  AUTH_EMAIL_REJECTED: {
    status: 422,
    severity: "user",
    message: "That email address was rejected. Check it and try again.",
  },
  AUTH_EMAIL_SEND_FAILED: {
    status: 503,
    severity: "system",
    message: "We couldn't send the email right now. Try again in a few minutes.",
  },
  AUTH_EMAIL_PARTIAL_UPDATE: {
    status: 500,
    severity: "system",
    message:
      "Your sign-in email changed but LITRACK couldn't save it. Don't try again yet — contact your administrator.",
  },

  // ── Requests ─────────────────────────────────────────────────────────────
  VALIDATION_FAILED: {
    status: 422,
    severity: "user",
    message: "{message}",
  },
  NOT_FOUND: {
    status: 404,
    severity: "user",
    message: "{resource} not found. It may have been deleted or moved.",
  },
  RATE_LIMITED: {
    status: 429,
    severity: "security",
    message: "Too many requests. Try again in {wait}.",
  },
  NETWORK_UNREACHABLE: {
    status: 503,
    severity: "user",
    message: "Couldn't reach LITRACK. Check your internet connection and try again.",
  },

  // ── Our side ─────────────────────────────────────────────────────────────
  DB_CONFLICT: {
    status: 409,
    severity: "system",
    message:
      "This conflicts with a record that already exists. Refresh the page and check before trying again.",
  },
  DB_SCHEMA_OUT_OF_DATE: {
    status: 503,
    severity: "system",
    message:
      "Couldn't {verb}: the database is missing an update this version of LITRACK needs. Trying again won't help — ask your administrator to finish the pending update.",
  },
  DB_UNAVAILABLE: {
    status: 503,
    severity: "system",
    message: "Couldn't {verb}: the database didn't respond in time. Wait a few seconds and try again.",
  },
  DB_ERROR: {
    status: 500,
    severity: "system",
    message:
      "Couldn't {verb}: the database rejected the change. Try again, and if it keeps failing, contact your administrator.",
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    severity: "system",
    message: "{service} isn't responding right now. Try again in a few minutes.",
  },
  CONFIG_MISSING: {
    status: 503,
    severity: "system",
    message: "This part of LITRACK isn't set up on the server yet. Contact your administrator.",
  },
  INTERNAL_ERROR: {
    status: 500,
    severity: "system",
    message:
      "An unexpected error stopped this from finishing. Try again, and if it keeps happening, contact your administrator.",
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERRORS;

/** What a placeholder says when the thrower did not supply it. */
const DEFAULT_PARAMS: Readonly<Record<string, string>> = {
  verb: "finish that",
  resource: "Record",
  service: "A connected service",
  wait: "a few minutes",
  what: "this",
  message: "Check the highlighted field and try again.",
};

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERRORS, value);
}

export function formatMessage(code: ErrorCode, params: ErrorParams = {}): string {
  return ERRORS[code].message.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = Object.hasOwn(params, key) ? params[key] : DEFAULT_PARAMS[key];
    return value === undefined ? "" : String(value);
  });
}

/** The reference goes last, where a person copying it will look. */
export function withReference(message: string, ref: string | undefined): string {
  return ref ? `${message} Reference: ${ref}` : message;
}

/** "1 minute" / "4 minutes" — never "0 minutes", which reads as "now". */
export function formatWait(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
