import { z } from "zod";

/**
 * `/admin/archive` — each of the four actions takes exactly one row id.
 * Deliberately one row at a time, no batching: spec section 5 rules out bulk
 * purge because a misclicked bulk permanent delete has no recovery path.
 */
export const archiveRowSchema = z.object({
  id: z.string().uuid("That row could not be identified."),
});

export type ArchiveRowInput = z.infer<typeof archiveRowSchema>;
