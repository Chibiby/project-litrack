import { z } from "zod";

/**
 * Chat input rules.
 *
 * The body cap is the only interesting one. 2,000 characters is far more than
 * anyone types into a chat box and far less than a paste of a whole report,
 * which is the accident this exists to refuse — a 200KB message would be stored,
 * re-fetched by every poll, and rendered in a 360px panel.
 */

export const CHAT_BODY_MAX = 2000;

export const chatChannelKindSchema = z.enum(["SCHOOL", "ADMIN_DIRECT"]);

export const sendChatMessageSchema = z.object({
  channelId: z.string().uuid("Unknown conversation"),
  body: z
    .string()
    .trim()
    .min(1, "Type a message first")
    .max(CHAT_BODY_MAX, `Keep it under ${CHAT_BODY_MAX} characters`),
});

export const openChannelSchema = z.object({
  kind: chatChannelKindSchema,
  /**
   * Which school's channel. Omitted by a school member — their own school is
   * the only one they may open, and the action takes it from the session rather
   * than the request. Supplied only by an admin, who has no school of their own
   * and must name the one they are visiting.
   */
  schoolId: z.string().uuid().optional(),
  /**
   * `ADMIN_DIRECT` only, and admin-only: whose private thread to open. A member
   * opening their own gets it from the session.
   */
  memberId: z.string().uuid().optional(),
});

export const readChannelSchema = z.object({
  channelId: z.string().uuid(),
  /** Newest message the client already holds, for polling. */
  afterId: z.string().uuid().optional(),
});

export const markChannelReadSchema = z.object({
  channelId: z.string().uuid(),
});

export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
export type OpenChannelInput = z.infer<typeof openChannelSchema>;
export type ReadChannelInput = z.infer<typeof readChannelSchema>;
