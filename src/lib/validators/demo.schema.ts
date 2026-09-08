import { z } from "zod";

/**
 * The demo visibility switch. Accepts the shapes a checkbox, a switch and a
 * hidden input each produce, because the settings page has used all three
 * spellings for booleans elsewhere (see `setSchoolActiveSchema`).
 */
export const setDemoModeSchema = z.object({
  enabled: z
    .union([
      z.boolean(),
      z.literal("true"),
      z.literal("false"),
      z.literal("on"),
      z.literal("off"),
    ])
    .transform((v) => v === true || v === "true" || v === "on"),
});

/**
 * Reset hard-deletes the demo school, so it is typed-confirmation gated in the
 * UI the way the database console's destructive actions are. The server checks
 * the phrase too — a client that skips the dialog must not get a free reset.
 */
export const RESET_DEMO_CONFIRMATION = "RESET DEMO";

export const resetDemoSchema = z.object({
  confirm: z
    .string()
    .trim()
    .refine((v) => v === RESET_DEMO_CONFIRMATION, {
      message: `Type ${RESET_DEMO_CONFIRMATION} to confirm`,
    }),
});

export type SetDemoModeInput = z.infer<typeof setDemoModeSchema>;
