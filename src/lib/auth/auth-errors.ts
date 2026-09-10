/**
 * Telling "wrong password" apart from "Supabase is refusing to talk to us".
 *
 * Supabase Auth rate-limits the password grant per source IP — roughly 30
 * requests per five minutes on the default settings — and answers with
 * HTTP 429 `over_request_rate_limit` once the bucket is empty. That response
 * says nothing about the credential: the same password that worked a minute
 * ago fails, and keeps failing until the window slides.
 *
 * Every sign-in used to collapse that into the same "incorrect credentials"
 * sentence and audit row as a genuinely wrong password. Schools then spent
 * hours resetting passwords that were never wrong — the reset changes the one
 * thing that was already fine. Naming this failure is what makes it
 * diagnosable, so both halves of the app (browser and server) classify through
 * here. Pure and dependency-free for exactly that reason.
 */

/** Shown to the person signing in when Supabase Auth is the thing saying no. */
export const AUTH_RATE_LIMITED_MESSAGE =
  "Too many sign-in attempts right now. Wait about five minutes and try again — your password has not changed, so there is no need to reset it.";

const RATE_LIMIT_CODES = new Set(["over_request_rate_limit", "over_email_send_rate_limit"]);

const RATE_LIMIT_TEXT = /rate limit|too many requests|request rate/i;

/**
 * Whether a Supabase auth failure is the rate limiter rather than the credential.
 *
 * Matches on three independent signals because supabase-js surfaces this
 * differently by version and transport: `status` 429 on `AuthApiError`, a
 * machine-readable `code`/`error_code`, and the human message. Any one is
 * enough — none of them is guaranteed to be present.
 */
export function isAuthRateLimitError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const err = error as { status?: unknown; code?: unknown; error_code?: unknown; message?: unknown };

  if (err.status === 429) return true;

  for (const code of [err.code, err.error_code]) {
    if (typeof code === "string" && RATE_LIMIT_CODES.has(code)) return true;
  }

  return typeof err.message === "string" && RATE_LIMIT_TEXT.test(err.message);
}
