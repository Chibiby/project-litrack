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
export const optionalString = z.string().trim().optional().or(z.literal("").transform(() => undefined));
