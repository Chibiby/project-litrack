import { z } from "zod";
import { AralMosyMoveOutReason, AralMosyOutcome, ReadingProfile } from "@prisma/client";

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
