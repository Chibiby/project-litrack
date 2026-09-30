import { z } from "zod";
import { AralMosyMoveOutReason, AralMosyOutcome, ReadingProfile } from "@prisma/client";

import { MOSY_STATUSES } from "@/lib/aral/mosy";
import { reportPurposeSchema } from "@/lib/validators/report.schema";

export const MOSY_REMARKS_MAX = 250;

/**
 * Grade-dependent rules (level allowed, reason allowed) are deliberately NOT
 * here: the grade must come from the DB-loaded learner, so they live in
 * `resolveMosySave`.
 */
export const aralMosyDecisionSchema = z
  .object({
    learnerId: z.string().uuid("Invalid learner"),
    mosyLevel: z.nativeEnum(ReadingProfile, { message: "Choose a MOSY reading level" }),
    decision: z
      .union([z.nativeEnum(AralMosyOutcome), z.literal("")])
      .default("")
      .transform((v) => v || null),
    reason: z
      .union([z.nativeEnum(AralMosyMoveOutReason), z.literal("")])
      .default("")
      .transform((v) => v || null),
    improvedToLevel: z
      .union([z.nativeEnum(ReadingProfile), z.literal("")])
      .default("")
      .transform((v) => v || null),
    remarks: z
      .string()
      .trim()
      .max(MOSY_REMARKS_MAX, "Remarks can be up to 250 characters")
      .default("")
      .transform((v) => v || null),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "MOVE_OUT" && !v.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Choose a reason for moving the learner out",
      });
    }
    if (v.decision === "MOVE_OUT" && v.reason === "IMPROVED_READING_LEVEL" && !v.improvedToLevel) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Choose the reading level the learner improved to",
      });
    }
  })
  .transform((v) => {
    const reason = v.decision === "MOVE_OUT" ? v.reason : null;
    return {
      ...v,
      reason,
      improvedToLevel: reason === "IMPROVED_READING_LEVEL" ? v.improvedToLevel : null,
    };
  });

export type AralMosyDecisionInput = z.output<typeof aralMosyDecisionSchema>;

/**
 * MOSY page export. Carries only the page's list filters and the file choice;
 * the school, school year and tutor scope come from the session, never from here.
 * `grade` / `section` are ids and are only shape-checked: the loader pins them to
 * the session's school, so a foreign id matches nothing.
 */
export const aralMosyExportSchema = z.object({
  format: z.enum(["EXCEL", "PDF"], { message: "Choose Excel or PDF" }),
  purpose: reportPurposeSchema,
  q: z.string().trim().max(100, "Search is too long").default(""),
  grade: z.string().trim().max(64, "Invalid grade").default("").transform((v) => v || "all"),
  section: z.string().trim().max(64, "Invalid section").default("").transform((v) => v || "all"),
  status: z.enum(MOSY_STATUSES, { message: "Invalid status" }).default("all"),
});

export type AralMosyExportInput = z.output<typeof aralMosyExportSchema>;
