import { z } from "zod";
import { nonEmpty } from "./common";

export const createSchoolSchema = z.object({
  name: nonEmpty("School name required").max(200),
  schoolIdCode: z
    .string()
    .trim()
    .min(4, "School ID must be at least 4 characters")
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Only letters, digits, underscore and dash"),
  address: z.string().trim().max(500).optional().or(z.literal("").transform(() => undefined)),
  region: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  division: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  district: z.string().trim().max(100).optional().or(z.literal("").transform(() => undefined)),
  schoolHeadEmail: z.string().email().optional(),
});

export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;
