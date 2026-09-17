import { z } from "zod";

/**
 * The one identifier any avatar action accepts from a client.
 *
 * `uploadOwnAvatar` and `removeOwnAvatar` take no target at all — a person sets
 * only their own photo — so this belongs to `removeUserAvatar` alone, where the
 * id names somebody the caller may or may not have authority over.
 * `decideAvatarModeration` decides that; this only proves the value is an id.
 *
 * The message is deliberately the same shape as the generic NOT_FOUND those
 * refusals produce, so a malformed id and a live id in another school do not
 * read differently.
 */
export const avatarModerationSchema = z.object({
  userId: z.string().uuid("That account could not be identified."),
});

export type AvatarModerationInput = z.infer<typeof avatarModerationSchema>;
