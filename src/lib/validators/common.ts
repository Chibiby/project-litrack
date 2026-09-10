import { z } from "zod";

export const nonEmpty = (msg = "Required") => z.string().trim().min(1, msg);
/**
 * Login and contact addresses are case-insensitive in practice, so they are
 * lower-cased here rather than at each call site — several used to forget, which
 * let a case-variant duplicate of an existing account through.
 */
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Email is required")
  .email("Enter a valid email address");
/**
 * Whether a raw input would pass `email`.
 *
 * For per-step wizard checks, which validate one page's fields before advancing
 * and so cannot run the whole profile schema. Delegating to `email` rather than
 * re-writing the pattern is the point: a step that accepted an address the
 * schema then rejected would fail at submit, several steps later.
 */
export function isValidEmail(raw: string): boolean {
  return email.safeParse(raw).success;
}

export const optionalString = z.string().trim().optional().or(z.literal("").transform(() => undefined));
