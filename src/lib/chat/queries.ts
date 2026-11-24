import "server-only";
import { prisma } from "@/lib/prisma";
import { previewLine } from "@/lib/chat/view";

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
  /** Whether this school is the Test Lab demo tenant. */
  isDemoSchool: boolean;
  /** The staff room, if it has been opened. Null before anyone has looked. */
  staffRoom: {
    id: string;
    lastMessageAt: Date | null;
    unread: boolean;
    /** "Ana: Can I ask…", "You: …" or "Message removed". Absent for an empty room. */
    preview?: string;
  } | null;
  /** Private threads members opened with the admin team. */
  directThreads: {
    id: string;
    memberId: string;
    memberName: string;
    memberRole: string;
    lastMessageAt: Date | null;
    lastOnlineAt: Date | null;
    unread: boolean;
    preview?: string;
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
      school: { select: { name: true, isDemo: true } },
      member: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          fullName: true,
          role: true,
          lastOnlineAt: true,
        },
      },
      // The admin team shares one inbox: a conversation any Super Admin has
      // read (or answered — a send marks the sender's read) is read for all.
      reads: {
        where: { user: { role: "SUPER_ADMIN" } },
        orderBy: { lastReadAt: "desc" },
        take: 1,
        select: { lastReadAt: true },
      },
      // The newest message only, for the conversation list's preview line.
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          authorId: true,
          body: true,
          deletedAt: true,
          author: { select: { firstName: true, fullName: true } },
        },
      },
    },
  });

  const bySchool = new Map<string, AdminChatSchool>();

  for (const channel of channels) {
    const entry = bySchool.get(channel.schoolId) ?? {
      schoolId: channel.schoolId,
      schoolName: channel.school.name,
      isDemoSchool: channel.school.isDemo,
      staffRoom: null,
      directThreads: [],
    };

    const readAt = channel.reads[0]?.lastReadAt ?? null;
    const unread = Boolean(
      channel.lastMessageAt && (!readAt || channel.lastMessageAt > readAt)
    );

    const last = channel.messages?.[0];
    const preview = last
      ? previewLine(
          {
            authorId: last.authorId,
            body: last.body,
            deletedAt: last.deletedAt,
            authorFirstName:
              last.author?.firstName?.trim() || last.author?.fullName?.trim().split(/\s+/)[0] || "Someone",
          },
          adminId
        )
      : undefined;

    if (channel.kind === "SCHOOL") {
      entry.staffRoom = {
        id: channel.id,
        lastMessageAt: channel.lastMessageAt,
        unread,
        ...(preview ? { preview } : {}),
      };
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
        lastOnlineAt: member?.lastOnlineAt ?? null,
        unread,
        ...(preview ? { preview } : {}),
      });
    }

    bySchool.set(channel.schoolId, entry);
  }

  return [...bySchool.values()].sort((a, b) =>
    a.schoolName.localeCompare(b.schoolName)
  );
}
