import { z } from "zod";
import { TERM_PERIODS } from "@/lib/terms/windows";
import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";

const dateKey = z.string().refine(
  (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && formatLocalDateKey(parseLocalDateKey(value)) === value,
  "Use a valid date"
);

export const adminTermWindowsSchema = z.object({
  schoolYearId: z.string().uuid("Choose a valid school year").optional(),
  schoolYearIds: z.array(z.string().uuid("Choose valid school years")).min(1).optional(),
  terms: z.array(z.object({
    term: z.enum(TERM_PERIODS),
    startKey: dateKey,
    endKey: dateKey,
    deadlineKey: dateKey,
  })).length(3, "All three terms are required"),
}).superRefine((value, ctx) => {
  if (!value.schoolYearId && !value.schoolYearIds) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["schoolYearId"], message: "Choose a school or All schools" });
  }
  if (value.schoolYearId && value.schoolYearIds) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["schoolYearId"], message: "Choose one school scope" });
  }
});

export type AdminTermWindowsInput = z.infer<typeof adminTermWindowsSchema>;
