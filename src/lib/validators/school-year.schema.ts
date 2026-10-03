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

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * UTC-midnight instant for a `YYYY-MM-DD` key, or null when it is not a real
 * calendar day. Built from parts (never `new Date(string)` on free text) and
 * round-tripped so `2026-02-30` is rejected instead of rolling into March. UTC
 * midnight is also what the action stores into the `@db.Date` columns.
 */
function parseDateKey(value: string): Date | null {
  if (!DATE_KEY.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return null;
  }
  return date;
}

function refineYearFields(
  data: { label: string; startDate: string; endDate: string },
  ctx: z.RefinementCtx
) {
  const start = parseDateKey(data.startDate);
  const end = parseDateKey(data.endDate);
  if (!start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid start date", path: ["startDate"] });
  }
  if (!end) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid end date", path: ["endDate"] });
  }
  if (start && end && end <= start) {
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
