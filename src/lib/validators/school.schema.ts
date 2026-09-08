import { z } from "zod";
import { nonEmpty } from "./common";
import { formatOptionalLabel } from "@/lib/names";

/**
 * Optional place/organisation text (address, region, division, district).
 *
 * Letter case is left exactly as typed — "Region XI" and "Sample Central ES"
 * both break under title-casing — but internal whitespace is collapsed so the
 * same value cannot be stored two ways. Overflow is now an error: these used to
 * `.slice()` silently, which cut a long address mid-word with nothing shown to
 * the person who typed it.
 */
function optionalLabel(max: number, label: string) {
  return z
    .union([z.string(), z.undefined(), z.null()])
    .transform((v) => (v == null ? undefined : formatOptionalLabel(String(v))))
    .pipe(
      z.union([
        z.string().max(max, `${label} must be ${max} characters or fewer`),
        z.undefined(),
      ])
    );
}

const optionalField = optionalLabel(500, "Address");
const optionalShort = optionalLabel(100, "This field");

export const createSchoolSchema = z.object({
  name: nonEmpty("School name required").max(200),
  schoolIdCode: z
    .string()
    .trim()
    .min(6, "School ID must be at least 6 characters")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Only letters, digits, underscore and dash"),
  address: optionalField,
  region: optionalShort,
  division: optionalShort,
  district: optionalShort,
  schoolHeadEmail: z.string().email().optional(),
});

/** School Head may edit display fields; schoolIdCode is immutable. */
export const updateSchoolInfoSchema = z.object({
  name: nonEmpty("School name required").max(200),
  address: optionalField,
  region: optionalShort,
  division: optionalShort,
  district: optionalShort,
});

export const setSchoolActiveSchema = z.object({
  schoolId: nonEmpty("School required"),
  isActive: z
    .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("on"), z.literal("off")])
    .transform((v) => v === true || v === "true" || v === "on"),
});

export const adminProfileSchema = z.object({
  firstName: nonEmpty("First name required").max(100),
  middleName: optionalShort,
  lastName: nonEmpty("Last name required").max(100),
});

export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;
export type UpdateSchoolInfoInput = z.infer<typeof updateSchoolInfoSchema>;
export type SetSchoolActiveInput = z.infer<typeof setSchoolActiveSchema>;
export type AdminProfileInput = z.infer<typeof adminProfileSchema>;
