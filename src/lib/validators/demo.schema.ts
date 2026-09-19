import { z } from "zod";

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

