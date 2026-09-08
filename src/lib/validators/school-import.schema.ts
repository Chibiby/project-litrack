import { z } from "zod";
import { nonEmpty } from "./common";
import { formatOptionalLabel } from "@/lib/names";

/**
 * The School ID doubles as the School Head's first-time Supabase password, so the
 * 6-character floor is Supabase's `password_min_length`, not an arbitrary choice.
 * Kept identical to `createSchoolSchema.schoolIdCode` in ./school.schema.ts so the
 * admin form and the roster import can never drift apart.
 */
export const schoolIdCodeSchema = z
  .string()
  .trim()
  .min(6, "School ID must be at least 6 characters")
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Only letters, digits, underscore and dash");

/**
 * Same rules as the admin form's fields in ./school.schema.ts: whitespace is
 * canonicalised, case is left alone, and an over-long value is rejected with a
 * row error rather than silently truncated mid-import.
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

const optionalShort = optionalLabel(100, "This field");
const optionalLong = optionalLabel(500, "Address");

export const schoolRosterRowSchema = z.object({
  schoolIdCode: schoolIdCodeSchema,
  name: nonEmpty("School name required").max(200),
  district: optionalShort,
  region: optionalShort,
  division: optionalShort,
  address: optionalLong,
});

export type SchoolRosterRowInput = z.infer<typeof schoolRosterRowSchema>;
