import { describe, expect, it, vi } from "vitest";

const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { chatChannel: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

import { listAdminChatSchools } from "@/lib/chat/queries";

describe("listAdminChatSchools", () => {
  it("maps member presence onto direct threads but not the school room", async () => {
    const lastOnlineAt = new Date("2026-09-12T10:00:00.000Z");
    findMany.mockResolvedValue([
      {
        id: "school-room",
        kind: "SCHOOL",
        schoolId: "school-1",
        lastMessageAt: new Date("2026-09-12T09:00:00.000Z"),
        school: { name: "Malandag Central ES" },
        member: null,
        reads: [],
      },
      {
        id: "direct-1",
        kind: "ADMIN_DIRECT",
        schoolId: "school-1",
        lastMessageAt: new Date("2026-09-12T11:00:00.000Z"),
        school: { name: "Malandag Central ES" },
        member: {
          id: "teacher-1",
          firstName: "Marivic",
          lastName: "Acibar",
          fullName: "Marivic Acibar",
          role: "TEACHER",
          lastOnlineAt,
        },
        reads: [{ lastReadAt: new Date("2026-09-12T10:30:00.000Z") }],
      },
    ]);

    const result = await listAdminChatSchools("admin-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          member: {
            select: expect.objectContaining({ lastOnlineAt: true }),
          },
        }),
      })
    );
    expect(result[0]?.staffRoom).toEqual({
      id: "school-room",
      lastMessageAt: new Date("2026-09-12T09:00:00.000Z"),
      unread: true,
    });
    expect(result[0]?.directThreads[0]).toEqual(
      expect.objectContaining({
        id: "direct-1",
        memberId: "teacher-1",
        lastOnlineAt,
        unread: true,
      })
    );
  });
});
