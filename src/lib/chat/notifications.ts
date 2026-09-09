import "server-only";
import { prisma } from "@/lib/prisma";
import type { ShellNotification } from "@/components/shell/notifications-menu";

/**
 * Chat alerts for the header bell.
 *
 * Persisted, unlike the derived dashboard alerts next door: a mention is an
 * event at a moment in time, and "you were tagged in the staff room on Tuesday"
 * cannot be recomputed from current counts the way "3 profiles incomplete" can.
 * That is what the existing `Notification` table is for, so this reads it rather
 * than adding a second mechanism.
 *
 * Only ids are stored on those rows, so the sentence is composed here from the
 * current actor and school — a renamed teacher or a closed school leaves no
 * stale text behind.
 */

/** Ceiling on one read. Somebody with more waiting has a bigger problem than paging. */
const LIMIT = 10;

export async function getChatNotifications(user: {
  id: string;
  role: string;
}): Promise<ShellNotification[]> {
  const rows = await prisma.notification.findMany({
    where: {
      recipientId: user.id,
      readAt: null,
      type: { in: ["CHAT_MENTION", "CHAT_DIRECT_MESSAGE"] },
    },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      type: true,
      channelId: true,
      actor: { select: { firstName: true, lastName: true, fullName: true, role: true } },
      school: { select: { name: true } },
    },
  });

  const isAdmin = user.role === "SUPER_ADMIN";

  return rows.map((row) => {
    const actorName =
      row.actor?.fullName?.trim() ||
      `${row.actor?.firstName ?? ""} ${row.actor?.lastName ?? ""}`.trim() ||
      "Someone";

    // An admin reads chat from their own pages; everyone else reads it in the
    // assistant panel, which has no route of its own — so the link takes them
    // to a page where the panel is reachable rather than nowhere.
    const href = isAdmin
      ? `/admin/chat${row.channelId ? `?channel=${row.channelId}` : ""}`
      : "/teacher";

    if (row.type === "CHAT_DIRECT_MESSAGE") {
      return {
        id: row.id,
        title: `${actorName} asked the admin team a question`,
        description: row.school?.name ?? "A school",
        href,
        tone: "amber" as const,
      };
    }

    return {
      id: row.id,
      title: `${actorName} mentioned you`,
      description: row.school?.name ?? "A school",
      href,
      tone: "violet" as const,
    };
  });
}

/**
 * Clear the chat alerts pointing at one channel.
 *
 * Called when the channel is opened: the notification exists to get somebody
 * there, and it has done its job the moment they arrive.
 */
export async function markChatNotificationsRead(input: {
  userId: string;
  channelId: string;
}): Promise<void> {
  await prisma.notification.updateMany({
    where: {
      recipientId: input.userId,
      channelId: input.channelId,
      readAt: null,
      type: { in: ["CHAT_MENTION", "CHAT_DIRECT_MESSAGE"] },
    },
    data: { readAt: new Date() },
  });
}
