import { z } from "zod";
import { TERM_PERIODS } from "@/lib/terms/windows";
import { formatLocalDateKey, parseLocalDateKey } from "@/lib/date-keys";

const dateKey = z.string().refine(
  (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && formatLocalDateKey(parseLocalDateKey(value)) === value,
  "Use a valid date"
);

export const adminTermWindowsSchema = z.object({
  schoolYearId: z.string().uuid("Choose a valid school year"),
  terms: z.array(z.object({
    term: z.enum(TERM_PERIODS),
    startKey: dateKey,
    endKey: dateKey,
    deadlineKey: dateKey,
  })).length(3, "All three terms are required"),
});

export type AdminTermWindowsInput = z.infer<typeof adminTermWindowsSchema>;
