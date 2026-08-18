import { z } from "zod";
import { nonEmpty } from "./common";

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

const optionalShort = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (v == null) return undefined;
    const trimmed = String(v).trim();
    return trimmed.length > 0 ? trimmed.slice(0, 100) : undefined;
  });

const optionalLong = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (v == null) return undefined;
    const trimmed = String(v).trim();
    return trimmed.length > 0 ? trimmed.slice(0, 500) : undefined;
  });

export const schoolRosterRowSchema = z.object({
  schoolIdCode: schoolIdCodeSchema,
  name: nonEmpty("School name required").max(200),
  district: optionalShort,
  region: optionalShort,
  division: optionalShort,
  address: optionalLong,
});

export type SchoolRosterRowInput = z.infer<typeof schoolRosterRowSchema>;
