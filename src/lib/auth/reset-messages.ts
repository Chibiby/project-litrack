/**
 * Fixed sentences for the `/auth/reset` page's error state.
 *
 * The page used to render `error_description ?? error` straight from the URL,
 * which is reflected text: anyone can craft a link that makes our page say
 * whatever they like. Nothing from the URL is ever returned here. The params
 * are only used to pick between sentences written in this file.
 *
 * Pure and isomorphic (no Prisma, no `server-only`).
 */

type Param = string | string[] | undefined;

export type ResetErrorParams = {
  error?: Param;
  error_code?: Param;
  error_description?: Param;
};

export const RESET_LINK_INVALID_MESSAGE =
  "This reset link is invalid or has expired. Request a new one.";

const RESET_LINK_EXPIRED_MESSAGE =
  "This reset link has expired or was already used. Request a new one.";

/** Supabase `error_code` values that mean the link itself is spent or stale. */
const EXPIRED_CODES = new Set(["otp_expired", "flow_state_expired", "flow_state_not_found"]);

function first(value: Param): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The sentence to show, or null when the URL carries no error at all.
 * Anything unrecognized gets the generic invalid-or-expired sentence.
 */
export function resetErrorMessage(params: ResetErrorParams): string | null {
  const error = first(params.error);
  const code = first(params.error_code);
  const description = first(params.error_description);
  if (!error && !code && !description) return null;

  if (code && EXPIRED_CODES.has(code.toLowerCase())) return RESET_LINK_EXPIRED_MESSAGE;

  // Supabase's own wording for a spent link, matched only to choose a fixed
  // sentence — never echoed.
  if (description && /expired|already (?:been )?used/i.test(description)) {
    return RESET_LINK_EXPIRED_MESSAGE;
  }

  // `access_denied` and the text `/auth/confirm/verify` redirects with both
  // mean the link cannot be used.
  return RESET_LINK_INVALID_MESSAGE;
}
