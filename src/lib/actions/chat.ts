"use server";

import { prisma } from "@/lib/prisma";
import { action } from "@/lib/errors/action";
import { AppError, resourceNotFound } from "@/lib/errors/app-error";
import { requireUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { parseMentionHandles } from "@/lib/chat/mentions";
import { markChatNotificationsRead } from "@/lib/chat/notifications";
import { canEditMessage, EDIT_WINDOW_MS, type ReactionEmoji } from "@/lib/chat/view";
import { chatSocketSecret, hasChatRoomBinding, publishRoomEvent } from "@/lib/chat/live/publish";
import { signTicket } from "@/lib/chat/live/ticket";
import { listAdminChatSchools, type AdminChatSchool } from "@/lib/chat/queries";
import {
  deleteChatMessageSchema,
  editChatMessageSchema,
  markChannelReadSchema,
  openChannelSchema,
  openChatSocketSchema,
  readChannelSchema,
  sendChatMessageSchema,
  toggleChatReactionSchema,
} from "@/lib/validators/chat.schema";
import type { ChatChannelKind, Prisma } from "@prisma/client";
import { RATE_LIMITS } from "@/lib/rate-limits/catalog";

/**
 * School chat, and the private line to the admin team.
 *
 * The access rule is one function — `assertChannelAccess` — and every entry
 * point goes through it. Chat is the first feature in this app where one user
 * writes text another user reads, so a tenancy mistake here does not leak a
 * count or a name: it hands somebody another school's staff-room conversation.
 *
 * Who may see what:
 *
 *   * `SCHOOL`       — any active member of that school. Not other schools.
 *   * `ADMIN_DIRECT` — the member who owns the thread, and Super Admins.
 *   * Super Admin    — every channel, because that role visits schools by
 *                      design. Each visit is audited.
 */

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

/** Messages returned in one read. A pilot school's staff room is not busy. */
const PAGE_SIZE = 50;

/** Per person, per minute. A chat box does not need more and a loop does. */
const SEND_LIMIT = RATE_LIMITS.chat;

export type ChatAuthor = {
  id: string;
  displayName: string;
  /** "Teacher", "School Head", "Administrator" — who is speaking, at a glance. */
  roleLabel: string;
  initials: string;
  isSelf: boolean;
};

export type ChatReactionView = {
  emoji: ReactionEmoji;
  userIds: string[];
  names: string[];
};

export type ChatReplyView = {
  id: string;
  authorName: string;
  /** First 120 characters; empty when the quoted message was removed. */
  excerpt: string;
  deleted: boolean;
};

export type ChatMessageView = {
  id: string;
  authorId: string;
  /** Empty when `deleted`: a delete blanks the text in the database too. */
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deleted: boolean;
  author: ChatAuthor;
  /** Resolved mentions, for rendering the handles as names. */
  mentions: { id: string; username: string | null; displayName: string }[];
  reactions: ChatReactionView[];
  replyTo: ChatReplyView | null;
};

export type ChatReaderView = { userId: string; name: string; readAt: Date };
export type ChatMemberView = { userId: string; name: string; initials: string; lastOnlineAt: Date | null };

export type ChatChannelView = {
  id: string;
  kind: ChatChannelKind;
  schoolName: string;
  messages: ChatMessageView[];
  viewerId: string;
  viewerIsAdmin: boolean;
  /**
   * Other people's read markers. Super Admins are left out for a non-admin
   * viewer (owner decision 2026-11-24: an admin's presence is never shown to
   * staff, and "Seen by" would reveal it).
   */
  readers: ChatReaderView[];
  /** People in this room, for presence. Super Admins left out the same way. */
  members: ChatMemberView[];
};

export type ChatSocketTicket = { live: false } | { live: true; ticket: string; url: "/chat-ws" };

/** Characters of a quoted message shown in a reply. */
const REPLY_EXCERPT_MAX = 120;

function displayNameOf(user: {
  fullName: string | null;
  firstName: string;
  lastName: string;
}): string {
  return user.fullName?.trim() || `${user.firstName} ${user.lastName}`.trim();
}

function initialsOf(user: { firstName: string; lastName: string }): string {
  const a = user.firstName.trim().charAt(0);
  const b = user.lastName.trim().charAt(0);
  return `${a}${b}`.toUpperCase() || "?";
}

/**
 * How the room addresses this person.
 *
 * A bare name reads as a system string. In a DepEd school these people call
 * each other by role, and a reader scanning a thread needs to know whether the
 * answer came from a colleague or from the division.
 */
function roleLabelOf(role: string): string {
  if (role === "SUPER_ADMIN") return "Administrator";
  if (role === "SCHOOL_HEAD") return "School Head";
  return "Teacher";
}

const AUTHOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  fullName: true,
  username: true,
  role: true,
} satisfies Prisma.UserSelect;

/**
 * The single access gate. Throws a generic "Not found" for anything the caller
 * may not see, so a channel in another school is indistinguishable from one that
 * does not exist.
 */
async function assertChannelAccess(
  channelId: string,
  user: { id: string; role: string; schoolId: string | null }
) {
  const channel = await prisma.chatChannel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      kind: true,
      schoolId: true,
      memberId: true,
      school: { select: { name: true } },
    },
  });
  if (!channel) throw resourceNotFound("Conversation");

  if (user.role === "SUPER_ADMIN") return channel;

  // Same sentence to the person as a missing channel, but recorded as a refusal.
  if (channel.schoolId !== user.schoolId) {
    throw resourceNotFound("Conversation", { crossTenant: true });
  }
  if (channel.kind === "ADMIN_DIRECT" && channel.memberId !== user.id) {
    throw resourceNotFound("Conversation", { crossTenant: true });
  }
  return channel;
}

/**
 * A message and the channel it lives in, through the same gate. A message in a
 * channel the caller may not see reads as "Message not found", like a missing
 * one.
 */
async function loadMessageWithAccess(
  messageId: string,
  user: { id: string; role: string; schoolId: string | null }
) {
  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, authorId: true, body: true, createdAt: true, deletedAt: true },
  });
  if (!message) throw resourceNotFound("Message");
  try {
    const channel = await assertChannelAccess(message.channelId, user);
    return { message, channel };
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") {
      throw resourceNotFound("Message", { crossTenant: true });
    }
    throw err;
  }
}

/** Users a body's @handles may notify: the channel's school, plus every admin. */
async function resolveMentionedUsers(body: string, schoolId: string) {
  const handles = parseMentionHandles(body);
  if (handles.length === 0) return [];
  return prisma.user.findMany({
    where: {
      username: { in: handles, mode: "insensitive" },
      deletedAt: null,
      isActive: true,
      OR: [{ schoolId }, { role: "SUPER_ADMIN" }],
    },
    select: { id: true, role: true },
  });
}

async function assertChatRate(userId: string) {
  const limit = await checkRateLimit(`chat:${userId}`, SEND_LIMIT);
  if (!limit.ok) {
    throw new AppError("VALIDATION_FAILED", { params: { message: "You are sending messages too quickly" } });
  }
}

const nowIso = () => new Date().toISOString();

/**
 * Find or create the channel this person is asking for.
 *
 * `upsert` on the partial unique index rather than find-then-create: two tabs
 * opening the staff room at once would otherwise race and produce two channels,
 * which splits the conversation permanently.
 */
export const openChannel = action("openChannel", async (input: unknown): Promise<ActionResult<{ id: string }>> => {
  const user = await requireUser();
  const parsed = openChannelSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { kind } = parsed.data;

  const isAdmin = user.role === "SUPER_ADMIN";
  // A school member may only ever open their own school's channel, and the id
  // comes from the session — never from the request.
  const schoolId = isAdmin ? parsed.data.schoolId : user.schoolId;
  if (!schoolId) return { ok: false, error: "No school to open a conversation in" };

  const memberId =
    kind === "ADMIN_DIRECT" ? (isAdmin ? parsed.data.memberId : user.id) : null;
  if (kind === "ADMIN_DIRECT" && !memberId) {
    return { ok: false, error: "Not found" };
  }

  // An admin naming a member must not be able to name one from another school.
  if (isAdmin && memberId) {
    const member = await prisma.user.findFirst({
      where: { id: memberId, schoolId, deletedAt: null },
      select: { id: true },
    });
    if (!member) return { ok: false, error: "Not found" };
  }

  const existing = await prisma.chatChannel.findFirst({
    where: { schoolId, kind, memberId },
    select: { id: true },
  });
  if (existing) return { ok: true, data: { id: existing.id } };

  try {
    const created = await prisma.chatChannel.create({
      data: { schoolId, kind, memberId },
      select: { id: true },
    });
    return { ok: true, data: { id: created.id } };
  } catch (err) {
    // Lost the race against another tab; the partial unique index refused the
    // duplicate, which is exactly what it is for. Read the winner.
    const winner = await prisma.chatChannel.findFirst({
      where: { schoolId, kind, memberId },
      select: { id: true },
    });
    if (winner) return { ok: true, data: { id: winner.id } };
    // No winner means this was not the race: let action() classify it.
    throw err;
  }
}, { verb: "open the conversation" });

/** One channel's recent messages, newest last. */
export const readChannel = action("readChannel", async (input: unknown): Promise<ActionResult<ChatChannelView>> => {
  const user = await requireUser();
  const parsed = readChannelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const channel = await assertChannelAccess(parsed.data.channelId, user);
  const viewerIsAdmin = user.role === "SUPER_ADMIN";
  const NAME_SELECT = { firstName: true, lastName: true, fullName: true, role: true } as const;

  const [rows, reads, people] = await Promise.all([
    // Removed messages stay in the transcript as "Message removed"; their text
    // is already blank in the row, so nothing of them can leak here.
    prisma.chatMessage.findMany({
      where: { channelId: channel.id },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        body: true,
        createdAt: true,
        deletedAt: true,
        editedAt: true,
        authorId: true,
        author: { select: AUTHOR_SELECT },
        mentions: { select: { user: { select: AUTHOR_SELECT } } },
        reactions: {
          orderBy: { createdAt: "asc" },
          select: { emoji: true, userId: true, user: { select: NAME_SELECT } },
        },
        replyTo: {
          select: { id: true, body: true, deletedAt: true, author: { select: NAME_SELECT } },
        },
      },
    }),
    prisma.chatRead.findMany({
      where: { channelId: channel.id, userId: { not: user.id } },
      select: { userId: true, lastReadAt: true, user: { select: NAME_SELECT } },
    }),
    prisma.user.findMany({
      where: {
        id: { not: user.id },
        deletedAt: null,
        isActive: true,
        ...(channel.kind === "SCHOOL"
          ? { schoolId: channel.schoolId }
          : { OR: [{ id: channel.memberId ?? "" }, ...(viewerIsAdmin ? [{ role: "SUPER_ADMIN" as const }] : [])] }),
      },
      take: 100,
      select: { id: true, ...NAME_SELECT, lastOnlineAt: true },
    }),
  ]);

  // Owner decision 2026-11-24: staff never see a Super Admin's presence or reads.
  const visible = (role: string) => viewerIsAdmin || role !== "SUPER_ADMIN";

  return {
    ok: true,
    data: {
      id: channel.id,
      kind: channel.kind,
      schoolName: channel.school.name,
      viewerId: user.id,
      viewerIsAdmin,
      readers: reads
        .filter((r) => visible(r.user.role))
        .map((r) => ({ userId: r.userId, name: displayNameOf(r.user), readAt: r.lastReadAt })),
      members: people
        .filter((p) => visible(p.role))
        .map((p) => ({
          userId: p.id,
          name: displayNameOf(p),
          initials: initialsOf(p),
          lastOnlineAt: p.lastOnlineAt,
        })),
      messages: rows.reverse().map((row) => {
        const deleted = row.deletedAt !== null;
        const reactions = new Map<string, ChatReactionView>();
        if (!deleted) {
          for (const r of row.reactions) {
            const entry = reactions.get(r.emoji) ?? { emoji: r.emoji as ReactionEmoji, userIds: [], names: [] };
            entry.userIds.push(r.userId);
            entry.names.push(r.userId === user.id ? "You" : displayNameOf(r.user));
            reactions.set(r.emoji, entry);
          }
        }
        return {
          id: row.id,
          authorId: row.authorId,
          body: deleted ? "" : row.body,
          createdAt: row.createdAt,
          editedAt: deleted ? null : row.editedAt,
          deleted,
          author: {
            id: row.author.id,
            displayName: displayNameOf(row.author),
            roleLabel: roleLabelOf(row.author.role),
            initials: initialsOf(row.author),
            isSelf: row.author.id === user.id,
          },
          mentions: deleted
            ? []
            : row.mentions.map((m) => ({
                id: m.user.id,
                username: m.user.username,
                displayName: displayNameOf(m.user),
              })),
          reactions: [...reactions.values()],
          replyTo:
            deleted || !row.replyTo
              ? null
              : {
                  id: row.replyTo.id,
                  authorName: displayNameOf(row.replyTo.author),
                  excerpt: row.replyTo.deletedAt ? "" : row.replyTo.body.slice(0, REPLY_EXCERPT_MAX),
                  deleted: row.replyTo.deletedAt !== null,
                },
        };
      }),
    },
  };
}, { verb: "load the conversation" });

/**
 * Post a message, resolve its mentions, and notify.
 *
 * All of it in one transaction. A message whose mentions did not save is a
 * message that silently notified nobody, which is worse than a failed send: the
 * author believes they have asked for help and no one has been asked.
 */
export const sendChatMessage = action("sendChatMessage", async (input: unknown): Promise<ActionResult<{ id: string }>> => {
  const user = await requireUser();
  const parsed = sendChatMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { channelId, body, replyToId } = parsed.data;

  const limit = await checkRateLimit(`chat:${user.id}`, SEND_LIMIT);
  if (!limit.ok) return { ok: false, error: "You are sending messages too quickly" };

  const channel = await assertChannelAccess(channelId, user);

  // A quote must come from this same channel: a reply naming another school's
  // message must not be able to pull its text into this thread.
  if (replyToId) {
    const quoted = await prisma.chatMessage.findUnique({
      where: { id: replyToId },
      select: { channelId: true, deletedAt: true },
    });
    if (!quoted || quoted.channelId !== channel.id || quoted.deletedAt) {
      throw resourceNotFound("Message", { crossTenant: Boolean(quoted && quoted.channelId !== channel.id) });
    }
  }

  // Who this message may notify: the school's own members, plus every admin.
  // Resolving against this set is what stops an @mention reaching across
  // schools, and it is why the handles are looked up rather than trusted.
  const mentioned = await resolveMentionedUsers(body, channel.schoolId);

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: {
        channelId: channel.id,
        authorId: user.id,
        body,
        ...(replyToId ? { replyToId } : {}),
        mentions: {
          create: mentioned
            .filter((m) => m.id !== user.id)
            .map((m) => ({ userId: m.id })),
        },
      },
      select: { id: true },
    });

    await tx.chatChannel.update({
      where: { id: channel.id },
      data: { lastMessageAt: new Date() },
    });

    // The author has read their own message by definition. Without this their
    // own send marks their channel unread.
    await tx.chatRead.upsert({
      where: { channelId_userId: { channelId: channel.id, userId: user.id } },
      create: { channelId: channel.id, userId: user.id },
      update: { lastReadAt: new Date() },
    });

    const notifications: Prisma.NotificationCreateManyInput[] = mentioned
      .filter((m) => m.id !== user.id)
      .map((m) => ({
        schoolId: channel.schoolId,
        recipientId: m.id,
        actorId: user.id,
        type: "CHAT_MENTION" as const,
        channelId: channel.id,
      }));

    // A private question reaches every admin, because it is addressed to the
    // team rather than to one of them. Only the first message of a thread
    // notifies — a back-and-forth should not ping three admins per reply.
    if (channel.kind === "ADMIN_DIRECT" && user.role !== "SUPER_ADMIN") {
      const priorCount = await tx.chatMessage.count({
        where: { channelId: channel.id, authorId: { not: user.id } },
      });
      const isFirstAsk = priorCount === 0;
      if (isFirstAsk) {
        const admins = await tx.user.findMany({
          where: { role: "SUPER_ADMIN", deletedAt: null, isActive: true },
          select: { id: true },
        });
        for (const admin of admins) {
          if (notifications.some((n) => n.recipientId === admin.id)) continue;
          notifications.push({
            schoolId: channel.schoolId,
            recipientId: admin.id,
            actorId: user.id,
            type: "CHAT_DIRECT_MESSAGE" as const,
            channelId: channel.id,
          });
        }
      }
    }

    if (notifications.length > 0) {
      await tx.notification.createMany({ data: notifications });
    }

    return created;
  });

  // Ids and counts only. The body is a person's own words and never belongs in
  // an audit row.
  await writeAudit({
    action: AUDIT_ACTIONS.CHAT_MESSAGE_SEND,
    resource: "ChatChannel",
    resourceId: channel.id,
    userId: user.id,
    schoolId: channel.schoolId,
    metadata: { kind: channel.kind, mentions: mentioned.length },
  });

  await publishRoomEvent(channel.id, { type: "message.created", messageId: message.id, userId: user.id, at: nowIso() });

  return { ok: true, data: { id: message.id } };
}, { verb: "send your message" });

/**
 * Change the text of your own message, within the 15-minute window.
 *
 * Existing mention rows stay; only @handles added by the edit are resolved
 * and notified, so fixing a typo never pings the same people twice.
 */
export const editChatMessage = action("editChatMessage", async (input: unknown): Promise<ActionResult> => {
  const user = await requireUser();
  const parsed = editChatMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { messageId, body } = parsed.data;
  await assertChatRate(user.id);

  const { message, channel } = await loadMessageWithAccess(messageId, user);
  if (message.authorId !== user.id) {
    throw new AppError("VALIDATION_FAILED", { params: { message: "You can only edit your own messages" } });
  }
  if (!canEditMessage(message, user.id)) {
    throw new AppError("VALIDATION_FAILED", { params: { message: "This message can no longer be edited" } });
  }

  const mentioned = (await resolveMentionedUsers(body, channel.schoolId)).filter((m) => m.id !== user.id);
  const existing = new Set(
    (await prisma.chatMention.findMany({ where: { messageId }, select: { userId: true } })).map((m) => m.userId)
  );
  const added = mentioned.filter((m) => !existing.has(m.id));

  await prisma.$transaction(async (tx) => {
    // Re-checked in the write itself: a delete (or the window closing) can land
    // between the read above and here, and an edit must never put text back
    // into a removed message.
    const now = new Date();
    const { count } = await tx.chatMessage.updateMany({
      where: { id: messageId, deletedAt: null, createdAt: { gte: new Date(now.getTime() - EDIT_WINDOW_MS) } },
      data: { body, editedAt: now },
    });
    if (count === 0) {
      throw new AppError("VALIDATION_FAILED", { params: { message: "This message can no longer be edited" } });
    }
    if (added.length > 0) {
      await tx.chatMention.createMany({ data: added.map((m) => ({ messageId, userId: m.id })) });
      await tx.notification.createMany({
        data: added.map((m) => ({
          schoolId: channel.schoolId,
          recipientId: m.id,
          actorId: user.id,
          type: "CHAT_MENTION" as const,
          channelId: channel.id,
        })),
      });
    }
  });

  await publishRoomEvent(channel.id, { type: "message.updated", messageId, userId: user.id, at: nowIso() });
  return { ok: true };
}, { verb: "edit your message" });

/**
 * Remove a message. The author may remove their own at any time; a Super
 * Admin may remove any message in a channel they can see (moderation,
 * audited). The text is blanked in the row, not hidden (owner decision
 * 2026-11-24), and its reactions and mentions go with it.
 */
export const deleteChatMessage = action("deleteChatMessage", async (input: unknown): Promise<ActionResult> => {
  const user = await requireUser();
  const parsed = deleteChatMessageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const { message, channel } = await loadMessageWithAccess(parsed.data.messageId, user);
  const isAuthor = message.authorId === user.id;
  const isAdmin = user.role === "SUPER_ADMIN";
  if (!isAuthor && !isAdmin) {
    throw new AppError("VALIDATION_FAILED", { params: { message: "You can only delete your own messages" } });
  }
  if (message.deletedAt) return { ok: true };

  await prisma.$transaction(async (tx) => {
    await tx.chatReaction.deleteMany({ where: { messageId: message.id } });
    await tx.chatMention.deleteMany({ where: { messageId: message.id } });
    await tx.chatMessage.update({ where: { id: message.id }, data: { body: "", deletedAt: new Date() } });
  });

  if (!isAuthor) {
    await writeAudit({
      action: AUDIT_ACTIONS.CHAT_MESSAGE_MODERATE,
      resource: "ChatMessage",
      resourceId: message.id,
      userId: user.id,
      schoolId: channel.schoolId,
      metadata: { channelId: channel.id, kind: channel.kind },
    });
  }

  await publishRoomEvent(channel.id, { type: "message.updated", messageId: message.id, userId: user.id, at: nowIso() });
  return { ok: true };
}, { verb: "delete the message" });

/** Add or remove one of the six reactions on a message. */
export const toggleChatReaction = action("toggleChatReaction", async (input: unknown): Promise<ActionResult<{ on: boolean }>> => {
  const user = await requireUser();
  const parsed = toggleChatReactionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { messageId, emoji } = parsed.data;
  await assertChatRate(user.id);

  const { message, channel } = await loadMessageWithAccess(messageId, user);
  if (message.deletedAt) throw resourceNotFound("Message");

  const existing = await prisma.chatReaction.findUnique({
    where: { messageId_userId_emoji: { messageId, userId: user.id, emoji } },
    select: { id: true },
  });
  let on: boolean;
  if (existing) {
    await prisma.chatReaction.delete({ where: { id: existing.id } });
    on = false;
  } else {
    try {
      await prisma.chatReaction.create({ data: { messageId, userId: user.id, emoji } });
    } catch (err) {
      // A double tap racing itself: the unique index already holds the row.
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
    on = true;
  }

  await publishRoomEvent(channel.id, { type: "reaction.changed", messageId, userId: user.id, at: nowIso() });
  return { ok: true, data: { on } };
}, { verb: "react to the message" });

/**
 * A 60-second ticket to join this channel's live room, or `{ live: false }`
 * when live chat is unavailable (no Durable Object binding, e.g. `next dev`,
 * or no signing secret). The client then keeps polling.
 */
export const openChatSocket = action("openChatSocket", async (input: unknown): Promise<ActionResult<ChatSocketTicket>> => {
  const user = await requireUser();
  const parsed = openChatSocketSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const channel = await assertChannelAccess(parsed.data.channelId, user);
  if (!hasChatRoomBinding()) return { ok: true, data: { live: false } };
  const secret = chatSocketSecret();
  if (!secret) return { ok: true, data: { live: false } };

  const ticket = await signTicket(
    {
      c: channel.id,
      u: user.id,
      n: displayNameOf(user),
      i: initialsOf(user),
      r: user.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "MEMBER",
    },
    secret
  );
  return { ok: true, data: { live: true, ticket, url: "/chat-ws" } };
}, { verb: "connect to live chat" });

/** Move this person's read marker to now. */
export const markChannelRead = action("markChannelRead", async (input: unknown): Promise<ActionResult> => {
  const user = await requireUser();
  const parsed = markChannelReadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const channel = await assertChannelAccess(parsed.data.channelId, user);
  await prisma.chatRead.upsert({
    where: { channelId_userId: { channelId: channel.id, userId: user.id } },
    create: { channelId: channel.id, userId: user.id },
    update: { lastReadAt: new Date() },
  });
  // The bell alert exists to get somebody here. Arriving is what clears it.
  await markChatNotificationsRead({ userId: user.id, channelId: channel.id });
  // A Super Admin's read is never shown to staff, so it is not published.
  if (user.role !== "SUPER_ADMIN") {
    await publishRoomEvent(channel.id, { type: "read.changed", userId: user.id, at: nowIso() });
  }
  return { ok: true };
}, { verb: "mark the conversation read" });

/**
 * Whether this person has anything waiting, per room.
 *
 * Deliberately a client-fetched action rather than another await in the role
 * layout: that layout's own comment records that a third query there bought a
 * longer blank-shell flash on every navigation in exchange for a bell badge.
 * This runs after paint, from the widget, and costs nothing until it does.
 */
/**
 * The Support hub's conversation list, for its 10 s poll. Reads only the list
 * (one row per channel plus its newest message) so the poll does not re-render
 * the whole Support page — tickets, every email recipient and the open
 * transcript — and does not hold up the admin's own chat actions behind a
 * page render.
 */
export const listAdminConversations = action("listAdminConversations", async (): Promise<
  ActionResult<AdminChatSchool[]>
> => {
  const user = await requireUser(["SUPER_ADMIN"]);
  return { ok: true, data: await listAdminChatSchools(user.id) };
}, { verb: "load your conversations" });

export const getMyChatUnread = action("getMyChatUnread", async (): Promise<
  ActionResult<{ school: boolean; admin: boolean }>
> => {
  const user = await requireUser();
  if (!user.schoolId) return { ok: true, data: { school: false, admin: false } };

  const channels = await prisma.chatChannel.findMany({
    where: {
      schoolId: user.schoolId,
      OR: [{ kind: "SCHOOL" }, { kind: "ADMIN_DIRECT", memberId: user.id }],
    },
    select: {
      kind: true,
      lastMessageAt: true,
      reads: { where: { userId: user.id }, select: { lastReadAt: true } },
    },
  });

  let school = false;
  let admin = false;
  for (const channel of channels) {
    const readAt = channel.reads[0]?.lastReadAt ?? null;
    const unread = Boolean(
      channel.lastMessageAt && (!readAt || channel.lastMessageAt > readAt)
    );
    if (!unread) continue;
    if (channel.kind === "SCHOOL") school = true;
    else admin = true;
  }

  return { ok: true, data: { school, admin } };
}, { verb: "check for new messages" });

/** People this channel can address, for the @mention picker. */
export const listMentionTargets = action("listMentionTargets", async (
  input: unknown
): Promise<ActionResult<{ id: string; username: string; displayName: string; roleLabel: string }[]>> => {
  const user = await requireUser();
  const parsed = readChannelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  const channel = await assertChannelAccess(parsed.data.channelId, user);
  const people = await prisma.user.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      username: { not: null },
      id: { not: user.id },
      OR: [{ schoolId: channel.schoolId }, { role: "SUPER_ADMIN" }],
    },
    orderBy: [{ role: "asc" }, { lastName: "asc" }],
    take: 100,
    select: AUTHOR_SELECT,
  });

  return {
    ok: true,
    data: people
      .filter((p): p is typeof p & { username: string } => Boolean(p.username))
      .map((p) => ({
        id: p.id,
        username: p.username,
        displayName: displayNameOf(p),
        roleLabel: roleLabelOf(p.role),
      })),
  };
}, { verb: "load the people you can mention" });
