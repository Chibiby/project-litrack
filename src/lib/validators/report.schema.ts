import { z } from "zod";
import { nonEmpty } from "./common";

/**
 * A local calendar day, `YYYY-MM-DD`. Same wire format the attendance grid
 * uses: the school runs at UTC+8, so a coerced `Date` would name the previous
 * day on a UTC lambda (`src/lib/date-keys.ts`).
 */
const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");

/**
 * One report request from the hub.
 *
 * Every filter is optional — a request with none of them is the widest report
 * the role may run, and the action narrows by role regardless. Ids are only
 * shape-checked here; that they belong to this tenant is decided in the action,
 * against the signed-in user, because a schema cannot know who is asking.
 */
export const reportGenerateSchema = z
  .object({
    kind: z.enum([
      "ATTENDANCE",
      "READING_LEVEL",
      "TERM_GRADES",
      "TEACHER_SUMMARY",
      "CLASS_ROSTER",
      "CUSTOM",
    ]),
    format: z.enum(["EXCEL", "PDF"]),
    schoolYearId: nonEmpty().nullish(),
    gradeLevelId: nonEmpty().nullish(),
    sectionId: nonEmpty().nullish(),
    from: dateKey.nullish(),
    to: dateKey.nullish(),
    term: z.enum(["FIRST", "SECOND", "THIRD"]).nullish(),
  })
  .refine((d) => !d.from || !d.to || d.from <= d.to, {
    message: "The start date must be on or before the end date",
    path: ["from"],
  });

export const reportIdSchema = z.object({ id: nonEmpty() });

export type ReportGenerateInput = z.infer<typeof reportGenerateSchema>;
