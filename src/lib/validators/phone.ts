import { z } from "zod";

/**
 * Philippine phone numbers (optional fields).
 * Accepts:
 * - Mobile: 09XXXXXXXXX, +639XXXXXXXXX, 639XXXXXXXXX
 * - Landline-ish: 0X XXX XXXX (area code + local), with optional spaces/dashes
 * Empty string → undefined (optional).
 */
export function normalizePhPhone(raw: string): string {
  return raw.trim().replace(/[\s\-().]/g, "");
}

export function isValidPhPhone(raw: string): boolean {
  const n = normalizePhPhone(raw);
  if (!n) return false;
  // Mobile: 09xxxxxxxxx (11) or +639xxxxxxxxx / 639xxxxxxxxx
  if (/^09\d{9}$/.test(n)) return true;
  if (/^\+?639\d{9}$/.test(n)) return true;
  // Landline: 0 + area 2–7 + local digits (e.g. 02xxxxxxx, 032xxxxxxx)
  if (/^0[2-7]\d{7,9}$/.test(n)) return true;
  // Mindanao landlines, 082–088 (Davao is 082, General Santos 083, Cagayan de Oro
  // 088). This whole block used to be rejected along with mobile 09x, which meant
  // LITRACK refused the landlines of the very region it is deployed in. 080 and
  // 081 stay invalid because the NTC has never assigned them.
  if (/^08[2-8]\d{6,8}$/.test(n)) return true;
  return false;
}

/**
 * Canonical storage form for a valid PH number: separators stripped, and the
 * three interchangeable mobile spellings (+639…, 639…, 09…) folded to the local
 * 09XXXXXXXXX that DepEd forms use. Landlines keep their leading 0.
 * Assumes the input already passed `isValidPhPhone`.
 */
export function canonicalPhPhone(raw: string): string {
  const n = normalizePhPhone(raw);
  const mobile = /^\+?63(9\d{9})$/.exec(n);
  return mobile ? `0${mobile[1]}` : n;
}

export const PH_PHONE_HINT =
  "Use a PH number, e.g. 09171234567 or +639171234567.";

export const optionalPhPhone = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .transform((v) => (v === "" || v === undefined ? undefined : v))
  .refine((v) => v === undefined || isValidPhPhone(v), {
    message: PH_PHONE_HINT,
  })
  // Canonicalise only once the number is known valid, so one phone can never be
  // stored three ways ("0917 123-4567", "+639171234567", "09171234567").
  .transform((v) => (v === undefined ? undefined : canonicalPhPhone(v)));
