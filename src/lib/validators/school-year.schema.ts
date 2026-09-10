import { z } from "zod";
import { nonEmpty } from "./common";

/** School year label like 2025-2026 */
const labelSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{4}$/, "Use format YYYY-YYYY (e.g. 2025-2026)");

/**
 * The label/date rules shared by create and update.
 *
 * Extracted rather than duplicated: a head correcting a mistake needs exactly
 * the same guardrails as one making the year in the first place, and the failure
 * mode of two copies is an edit dialog that happily saves `2025-2027` because
 * only the create path grew the consecutive-years check.
 */
const yearFields = {
  label: labelSchema,
  startDate: nonEmpty("Start date required"),
  endDate: nonEmpty("End date required"),
};

function refineYearFields(
  data: { label: string; startDate: string; endDate: string },
  ctx: z.RefinementCtx
) {
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
}

export const createSchoolYearSchema = z
  .object({
    ...yearFields,
    setActive: z
      .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("on"), z.literal("off")])
      .optional()
      .transform((v) => v === true || v === "true" || v === "on"),
  })
  .superRefine(refineYearFields);

/**
 * Correcting an existing year. Same field rules as create, plus the id.
 *
 * Deliberately has no `setActive`: activation is its own action with its own
 * audit row, so an edit can never silently move which year learners enrol
 * against as a side effect of fixing a typo.
 */
export const updateSchoolYearSchema = z
  .object({
    schoolYearId: nonEmpty("School year required"),
    ...yearFields,
  })
  .superRefine(refineYearFields);

export const setActiveSchoolYearSchema = z.object({
  schoolYearId: nonEmpty("School year required"),
});

export const deleteSchoolYearSchema = z.object({
  schoolYearId: nonEmpty("School year required"),
});

export type CreateSchoolYearInput = z.infer<typeof createSchoolYearSchema>;
export type UpdateSchoolYearInput = z.infer<typeof updateSchoolYearSchema>;
export type SetActiveSchoolYearInput = z.infer<typeof setActiveSchoolYearSchema>;
export type DeleteSchoolYearInput = z.infer<typeof deleteSchoolYearSchema>;
