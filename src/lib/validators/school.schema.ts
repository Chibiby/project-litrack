import { z } from "zod";
import { nonEmpty } from "./common";

const optionalField = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (v == null) return undefined;
    const trimmed = String(v).trim();
    return trimmed.length > 0 ? trimmed.slice(0, 500) : undefined;
  });

const optionalShort = z
  .union([z.string(), z.undefined(), z.null()])
  .transform((v) => {
    if (v == null) return undefined;
    const trimmed = String(v).trim();
    return trimmed.length > 0 ? trimmed.slice(0, 100) : undefined;
  });

export const createSchoolSchema = z.object({
  name: nonEmpty("School name required").max(200),
  schoolIdCode: z
    .string()
    .trim()
    .min(4, "School ID must be at least 4 characters")
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
