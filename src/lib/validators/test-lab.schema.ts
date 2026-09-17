import { z } from "zod";
import { TEST_LAB_PERSONAS } from "@/lib/test-lab/personas";

/**
 * `startTestLabSession` input. `next` is only shape-checked here; whether it is
 * an allowed destination is `isAllowedTestLabNext`'s call, and a disallowed one
 * falls back to the role home rather than failing the start.
 */
export const startTestLabSessionSchema = z.object({
  persona: z.enum(TEST_LAB_PERSONAS, {
    errorMap: () => ({ message: "Choose who to test as." }),
  }),
  next: z.string().optional(),
});

export type StartTestLabSessionInput = z.infer<typeof startTestLabSessionSchema>;
