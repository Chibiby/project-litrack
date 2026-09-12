import { z } from "zod";

/**
 * Super Admin accounts console (`/admin/accounts`).
 *
 * Every control on that page acts on exactly one account, identified by
 * `User.id`. Keyed on the user rather than the school on purpose: the console
 * lists people across every tenant, and a school id cannot name a teacher.
 *
 * The message is deliberately vague. A malformed id and an id belonging to an
 * account the caller may not act on must read identically, so nothing here can
 * be used to probe for which accounts exist.
 */
export const accountUserIdSchema = z.object({
  userId: z.string().uuid("That account could not be identified."),
});

export type AccountUserIdInput = z.infer<typeof accountUserIdSchema>;
