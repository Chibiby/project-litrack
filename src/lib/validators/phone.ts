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
  // Landline: 0 + area 2–7 (not mobile 8/9) + local digits (e.g. 02xxxxxxx, 032xxxxxxx)
  if (/^0[2-7]\d{7,9}$/.test(n)) return true;
  return false;
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
  });
