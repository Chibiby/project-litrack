import { describe, expect, it, vi } from "vitest";

const findMany = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: { chatChannel: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

import { listAdminChatSchools } from "@/lib/chat/queries";

function room(messages: unknown[]) {
  return {
    id: "school-room",
    kind: "SCHOOL",
    schoolId: "school-1",
    lastMessageAt: new Date("2026-11-24T09:00:00.000Z"),
    school: { name: "Malandag Central ES", isDemo: false },
    member: null,
    reads: [],
    messages,
  };
}

describe("listAdminChatSchools previews", () => {
  it("asks for only the newest message per channel", async () => {
    findMany.mockResolvedValue([]);
    await listAdminChatSchools("admin-1");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          messages: expect.objectContaining({ take: 1, orderBy: { createdAt: "desc" } }),
        }),
      })
    );
  });

  it("preview prefixes You: for own last message", async () => {
    findMany.mockResolvedValue([
      room([{ authorId: "admin-1", body: "We fixed it\nsecond line", deletedAt: null, author: { firstName: "Hugo", fullName: "Hugo S" } }]),
    ]);
    const [school] = await listAdminChatSchools("admin-1");
    expect(school?.staffRoom?.preview).toBe("You: We fixed it");
  });

  it("preview uses the first name of other authors", async () => {
    findMany.mockResolvedValue([
      room([{ authorId: "t-1", body: "Help please", deletedAt: null, author: { firstName: "Ana", fullName: "Ana Cruz" } }]),
    ]);
    const [school] = await listAdminChatSchools("admin-1");
    expect(school?.staffRoom?.preview).toBe("Ana: Help please");
  });

  it("preview says Message removed", async () => {
    findMany.mockResolvedValue([
      room([{ authorId: "t-1", body: "", deletedAt: new Date(), author: { firstName: "Ana", fullName: "Ana Cruz" } }]),
    ]);
    const [school] = await listAdminChatSchools("admin-1");
    expect(school?.staffRoom?.preview).toBe("Message removed");
  });

  it("an empty room has no preview", async () => {
    findMany.mockResolvedValue([room([])]);
    const [school] = await listAdminChatSchools("admin-1");
    expect(school?.staffRoom?.preview).toBeUndefined();
  });
});
