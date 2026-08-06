import { z } from "zod";
import { nonEmpty } from "./common";

/** School year label like 2025-2026 */
const labelSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{4}$/, "Use format YYYY-YYYY (e.g. 2025-2026)");

export const createSchoolYearSchema = z
  .object({
    label: labelSchema,
    startDate: nonEmpty("Start date required"),
    endDate: nonEmpty("End date required"),
    setActive: z
      .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("on"), z.literal("off")])
      .optional()
      .transform((v) => v === true || v === "true" || v === "on"),
  })
  .superRefine((data, ctx) => {
    const start = new Date(data.startDate);
    const end = new Date(data.endDate);
    if (Number.isNaN(start.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid start date", path: ["startDate"] });
    }
    if (Number.isNaN(end.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid end date", path: ["endDate"] });
    }
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end <= start) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "End date must be after start date",
        path: ["endDate"],
      });
    }
    const [a, b] = data.label.split("-").map(Number);
    if (a != null && b != null && b !== a + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Label years must be consecutive (e.g. 2025-2026)",
        path: ["label"],
      });
    }
  });

export const setActiveSchoolYearSchema = z.object({
  schoolYearId: nonEmpty("School year required"),
});

export type CreateSchoolYearInput = z.infer<typeof createSchoolYearSchema>;
export type SetActiveSchoolYearInput = z.infer<typeof setActiveSchoolYearSchema>;
