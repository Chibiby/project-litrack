import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * The admin's view of chat across the estate.
 *
 * Reads only — every write goes through the server actions, which share one
 * access gate. This file exists so the admin page can render server-side
 * without shipping a query to the browser.
 */

export type AdminChatSchool = {
  schoolId: string;
  schoolName: string;
  /** The staff room, if it has been opened. Null before anyone has looked. */
  staffRoom: { id: string; lastMessageAt: Date | null; unread: boolean } | null;
  /** Private threads members opened with the admin team. */
  directThreads: {
    id: string;
    memberId: string;
    memberName: string;
    memberRole: string;
    lastMessageAt: Date | null;
    unread: boolean;
  }[];
};

/**
 * Every school with a chat channel, and whether this admin has unread in it.
 *
 * "Unread" is the channel's newest message being newer than this admin's read
 * marker — one comparison, and it does not grow with the transcript.
 */
export async function listAdminChatSchools(adminId: string): Promise<AdminChatSchool[]> {
  const channels = await prisma.chatChannel.findMany({
    where: {
      school: { deletedAt: null },
      OR: [{ kind: "SCHOOL" }, { kind: "ADMIN_DIRECT", memberId: { not: null } }],
    },
    orderBy: [{ lastMessageAt: "desc" }],
    select: {
      id: true,
      kind: true,
      schoolId: true,
      lastMessageAt: true,
      school: { select: { name: true } },
      member: {
        select: { id: true, firstName: true, lastName: true, fullName: true, role: true },
      },
      reads: {
        where: { userId: adminId },
        select: { lastReadAt: true },
      },
    },
  });

  const bySchool = new Map<string, AdminChatSchool>();

  for (const channel of channels) {
    const entry = bySchool.get(channel.schoolId) ?? {
      schoolId: channel.schoolId,
      schoolName: channel.school.name,
      staffRoom: null,
      directThreads: [],
    };

    const readAt = channel.reads[0]?.lastReadAt ?? null;
    const unread = Boolean(
      channel.lastMessageAt && (!readAt || channel.lastMessageAt > readAt)
    );

    if (channel.kind === "SCHOOL") {
      entry.staffRoom = { id: channel.id, lastMessageAt: channel.lastMessageAt, unread };
    } else {
      const member = channel.member;
      entry.directThreads.push({
        id: channel.id,
        memberId: member?.id ?? "",
        memberName:
          member?.fullName?.trim() ||
          `${member?.firstName ?? ""} ${member?.lastName ?? ""}`.trim() ||
          "A member",
        memberRole: member?.role === "SCHOOL_HEAD" ? "School Head" : "Teacher",
        lastMessageAt: channel.lastMessageAt,
        unread,
      });
    }

    bySchool.set(channel.schoolId, entry);
  }

  return [...bySchool.values()].sort((a, b) =>
    a.schoolName.localeCompare(b.schoolName)
  );
}
