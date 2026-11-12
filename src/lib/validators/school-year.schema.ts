import { z } from "zod";
import { nonEmpty } from "./common";
import { parseMonthKey } from "@/lib/school-year/months";

/** School year label like 2025-2026 */
const labelSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{4}$/, "Use format YYYY-YYYY (e.g. 2025-2026)");

const startMonthSchema = nonEmpty("Start month required");

/** Blank means "not set yet" — a School Head may leave the end month empty. */
const endMonthSchema = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((v) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null));

function refineMonths(
  data: { startMonth: string; endMonth: string | null },
  ctx: z.RefinementCtx
) {
  const start = parseMonthKey(data.startMonth);
  if (!start) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pick a start month", path: ["startMonth"] });
  }
  if (data.endMonth === null) return;
  const end = parseMonthKey(data.endMonth);
  if (!end) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Pick an end month", path: ["endMonth"] });
    return;
  }
  if (start && end[0] * 12 + end[1] <= start[0] * 12 + start[1]) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End month must be after the start month",
      path: ["endMonth"],
    });
  }
}

/**
 * A Division Admin creating one school year for every school at once. Each
 * School Head then adjusts the months for their own school.
 */
export const createDivisionSchoolYearSchema = z
  .object({
    label: labelSchema,
    startMonth: startMonthSchema,
    endMonth: endMonthSchema,
    setActive: z
      .union([z.boolean(), z.literal("true"), z.literal("false"), z.literal("on"), z.literal("off")])
      .optional()
      .transform((v) => v === true || v === "true" || v === "on"),
  })
  .superRefine((data, ctx) => {
    const [a, b] = data.label.split("-").map(Number);
    if (a != null && b != null && b !== a + 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Label years must be consecutive (e.g. 2025-2026)",
        path: ["label"],
      });
    }
    refineMonths(data, ctx);
  });

/**
 * The only change a School Head makes to a school year: its start month and,
 * optionally, its end month. Label and activation belong to the Division Admin.
 */
export const setSchoolYearMonthsSchema = z
  .object({
    schoolYearId: nonEmpty("School year required"),
    startMonth: startMonthSchema,
    endMonth: endMonthSchema,
  })
  .superRefine(refineMonths);

/**
 * The Division Admin's active duration for one label. Both months are
 * required: the end month is when promotion unlocks and the year closes.
 */
export const setDivisionDurationSchema = z
  .object({
    label: labelSchema,
    startMonth: startMonthSchema,
    endMonth: nonEmpty("End month required"),
  })
  .superRefine((data, ctx) => refineMonths({ startMonth: data.startMonth, endMonth: data.endMonth }, ctx));

export const setActiveSchoolYearSchema = z.object({
  schoolYearId: nonEmpty("School year required"),
});

export const deleteSchoolYearSchema = z.object({
  schoolYearId: nonEmpty("School year required"),
});

export type CreateDivisionSchoolYearInput = z.infer<typeof createDivisionSchoolYearSchema>;
export type SetSchoolYearMonthsInput = z.infer<typeof setSchoolYearMonthsSchema>;
export type SetDivisionDurationInput = z.infer<typeof setDivisionDurationSchema>;
export type SetActiveSchoolYearInput = z.infer<typeof setActiveSchoolYearSchema>;
export type DeleteSchoolYearInput = z.infer<typeof deleteSchoolYearSchema>;
