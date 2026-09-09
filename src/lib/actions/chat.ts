"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { parseMentionHandles } from "@/lib/chat/mentions";
import { markChatNotificationsRead } from "@/lib/chat/notifications";
import {
  markChannelReadSchema,
  openChannelSchema,
  readChannelSchema,
  sendChatMessageSchema,
} from "@/lib/validators/chat.schema";
import type { ChatChannelKind, Prisma } from "@prisma/client";

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
const SEND_LIMIT = { limit: 30, windowMs: 60 * 1000 };

export type ChatAuthor = {
  id: string;
  displayName: string;
  /** "Teacher", "School Head", "Administrator" — who is speaking, at a glance. */
  roleLabel: string;
  initials: string;
  isSelf: boolean;
};

export type ChatMessageView = {
  id: string;
  body: string;
  createdAt: Date;
  author: ChatAuthor;
  /** Resolved mentions, for rendering the handles as names. */
  mentions: { id: string; username: string | null; displayName: string }[];
};

export type ChatChannelView = {
  id: string;
  kind: ChatChannelKind;
  schoolName: string;
  messages: ChatMessageView[];
};

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
  if (!channel) throw new Error("Not found");

  if (user.role === "SUPER_ADMIN") return channel;

  if (channel.schoolId !== user.schoolId) throw new Error("Not found");
  if (channel.kind === "ADMIN_DIRECT" && channel.memberId !== user.id) {
    throw new Error("Not found");
  }
  return channel;
}

/**
 * Find or create the channel this person is asking for.
 *
 * `upsert` on the partial unique index rather than find-then-create: two tabs
 * opening the staff room at once would otherwise race and produce two channels,
 * which splits the conversation permanently.
 */
export async function openChannel(input: unknown): Promise<ActionResult<{ id: string }>> {
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
  } catch {
    // Lost the race against another tab; the partial unique index refused the
    // duplicate, which is exactly what it is for. Read the winner.
    const winner = await prisma.chatChannel.findFirst({
      where: { schoolId, kind, memberId },
      select: { id: true },
    });
    if (winner) return { ok: true, data: { id: winner.id } };
    return { ok: false, error: "Could not open the conversation" };
  }
}

/** One channel's recent messages, newest last. */
export async function readChannel(input: unknown): Promise<ActionResult<ChatChannelView>> {
  const user = await requireUser();
  const parsed = readChannelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    const channel = await assertChannelAccess(parsed.data.channelId, user);

    const rows = await prisma.chatMessage.findMany({
      where: { channelId: channel.id, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: AUTHOR_SELECT },
        mentions: { select: { user: { select: AUTHOR_SELECT } } },
      },
    });

    return {
      ok: true,
      data: {
        id: channel.id,
        kind: channel.kind,
        schoolName: channel.school.name,
        messages: rows.reverse().map((row) => ({
          id: row.id,
          body: row.body,
          createdAt: row.createdAt,
          author: {
            id: row.author.id,
            displayName: displayNameOf(row.author),
            roleLabel: roleLabelOf(row.author.role),
            initials: initialsOf(row.author),
            isSelf: row.author.id === user.id,
          },
          mentions: row.mentions.map((m) => ({
            id: m.user.id,
            username: m.user.username,
            displayName: displayNameOf(m.user),
          })),
        })),
      },
    };
  } catch {
    return { ok: false, error: "Not found" };
  }
}

/**
 * Post a message, resolve its mentions, and notify.
 *
 * All of it in one transaction. A message whose mentions did not save is a
 * message that silently notified nobody, which is worse than a failed send: the
 * author believes they have asked for help and no one has been asked.
 */
export async function sendChatMessage(input: unknown): Promise<ActionResult<{ id: string }>> {
  const user = await requireUser();
  const parsed = sendChatMessageSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Invalid input" };
  }
  const { channelId, body } = parsed.data;

  const limit = await checkRateLimit(`chat:${user.id}`, SEND_LIMIT);
  if (!limit.ok) return { ok: false, error: "You are sending messages too quickly" };

  let channel;
  try {
    channel = await assertChannelAccess(channelId, user);
  } catch {
    return { ok: false, error: "Not found" };
  }

  // Who this message may notify: the school's own members, plus every admin.
  // Resolving against this set is what stops an @mention reaching across
  // schools, and it is why the handles are looked up rather than trusted.
  const handles = parseMentionHandles(body);
  const mentioned = handles.length
    ? await prisma.user.findMany({
        where: {
          username: { in: handles, mode: "insensitive" },
          deletedAt: null,
          isActive: true,
          OR: [{ schoolId: channel.schoolId }, { role: "SUPER_ADMIN" }],
        },
        select: { id: true, role: true },
      })
    : [];

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.chatMessage.create({
      data: {
        channelId: channel.id,
        authorId: user.id,
        body,
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

  return { ok: true, data: { id: message.id } };
}

/** Move this person's read marker to now. */
export async function markChannelRead(input: unknown): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = markChannelReadSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
    const channel = await assertChannelAccess(parsed.data.channelId, user);
    await prisma.chatRead.upsert({
      where: { channelId_userId: { channelId: channel.id, userId: user.id } },
      create: { channelId: channel.id, userId: user.id },
      update: { lastReadAt: new Date() },
    });
    // The bell alert exists to get somebody here. Arriving is what clears it.
    await markChatNotificationsRead({ userId: user.id, channelId: channel.id });
    return { ok: true };
  } catch {
    return { ok: false, error: "Not found" };
  }
}

/**
 * Whether this person has anything waiting, per room.
 *
 * Deliberately a client-fetched action rather than another await in the role
 * layout: that layout's own comment records that a third query there bought a
 * longer blank-shell flash on every navigation in exchange for a bell badge.
 * This runs after paint, from the widget, and costs nothing until it does.
 */
export async function getMyChatUnread(): Promise<
  ActionResult<{ school: boolean; admin: boolean }>
> {
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
}

/** People this channel can address, for the @mention picker. */
export async function listMentionTargets(
  input: unknown
): Promise<ActionResult<{ id: string; username: string; displayName: string; roleLabel: string }[]>> {
  const user = await requireUser();
  const parsed = readChannelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };

  try {
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
  } catch {
    return { ok: false, error: "Not found" };
  }
}
