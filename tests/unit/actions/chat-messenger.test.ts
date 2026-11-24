import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The messenger actions (edit, delete, react, reply, live ticket) and the
 * extended read. Every one resolves message → channel → `assertChannelAccess`,
 * so a foreign channel reads exactly like a missing one.
 */

const SCHOOL = "school-1";
const OTHER_SCHOOL = "school-2";
const CHANNEL = "11111111-1111-4111-8111-111111111111";
const OTHER_CHANNEL = "22222222-2222-4222-8222-222222222222";
const MSG = "33333333-3333-4333-8333-333333333333";
const REPLY_TARGET = "44444444-4444-4444-8444-444444444444";

const teacher = {
  id: "teacher-1",
  role: "TEACHER",
  schoolId: SCHOOL,
  firstName: "Ana",
  lastName: "Cruz",
  fullName: null,
  username: "ana",
};
const admin = {
  id: "admin-1",
  role: "SUPER_ADMIN",
  schoolId: null,
  firstName: "Dee",
  lastName: "Admin",
  fullName: null,
  username: "dee",
};

const db = {
  chatChannel: { findUnique: vi.fn(), update: vi.fn() },
  chatMessage: { findUnique: vi.fn(), findMany: vi.fn(async (): Promise<unknown[]> => []), update: vi.fn(), create: vi.fn(), count: vi.fn(async () => 1) },
  chatReaction: { findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  chatMention: { findMany: vi.fn(async (): Promise<unknown[]> => []), createMany: vi.fn(), deleteMany: vi.fn() },
  chatRead: { findMany: vi.fn(async (): Promise<unknown[]> => []), upsert: vi.fn() },
  user: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
  notification: { createMany: vi.fn() },
  $transaction: vi.fn(),
};
db.$transaction.mockImplementation(async (fn: unknown) =>
  typeof fn === "function" ? (fn as (tx: typeof db) => unknown)(db) : Promise.all(fn as unknown[])
);
vi.mock("@/lib/prisma", () => ({ prisma: db }));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: (...a: unknown[]) => requireUser(...a) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ ok: true })) }));
const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...a),
  AUDIT_ACTIONS: { CHAT_MESSAGE_SEND: "CHAT_MESSAGE_SEND", CHAT_MESSAGE_MODERATE: "CHAT_MESSAGE_MODERATE" },
}));
vi.mock("@/lib/chat/notifications", () => ({ markChatNotificationsRead: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined }));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-REF") }));

const publishRoomEvent = vi.fn(async () => {});
const hasChatRoomBinding = vi.fn(() => false);
const chatSocketSecret = vi.fn((): string | null => "socket-secret");
vi.mock("@/lib/chat/live/publish", () => ({
  publishRoomEvent: (...a: unknown[]) => publishRoomEvent(...(a as [])),
  hasChatRoomBinding: () => hasChatRoomBinding(),
  chatSocketSecret: () => chatSocketSecret(),
}));

const chat = await import("@/lib/actions/chat");
const { verifyTicket } = await import("@/lib/chat/live/ticket");

function ownChannel(overrides: Record<string, unknown> = {}) {
  return { id: CHANNEL, kind: "SCHOOL", schoolId: SCHOOL, memberId: null, school: { name: "Own ES" }, ...overrides };
}
function foreignChannel() {
  return { id: OTHER_CHANNEL, kind: "SCHOOL", schoolId: OTHER_SCHOOL, memberId: null, school: { name: "Other ES" } };
}
function message(overrides: Record<string, unknown> = {}) {
  return {
    id: MSG,
    channelId: CHANNEL,
    authorId: teacher.id,
    body: "hello",
    createdAt: new Date(Date.now() - 60_000),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue(teacher);
  db.chatChannel.findUnique.mockResolvedValue(ownChannel());
  db.chatMessage.findUnique.mockResolvedValue(message());
  db.chatMessage.create.mockResolvedValue({ id: "new-msg" });
  hasChatRoomBinding.mockReturnValue(false);
  chatSocketSecret.mockReturnValue("socket-secret");
});

describe("access", () => {
  it("each new action refuses another school's channel as NOT_FOUND", async () => {
    db.chatChannel.findUnique.mockResolvedValue(foreignChannel());
    db.chatMessage.findUnique.mockResolvedValue(message({ channelId: OTHER_CHANNEL }));
    const results = [
      await chat.editChatMessage({ messageId: MSG, body: "x" }),
      await chat.deleteChatMessage({ messageId: MSG }),
      await chat.toggleChatReaction({ messageId: MSG, emoji: "👍" }),
      await chat.openChatSocket({ channelId: OTHER_CHANNEL }),
    ];
    for (const res of results) {
      expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(JSON.stringify(res)).not.toContain("Other ES");
    }
    expect(db.chatMessage.update).not.toHaveBeenCalled();
    expect(db.chatReaction.create).not.toHaveBeenCalled();
  });

  it("a missing message reads like a foreign one", async () => {
    db.chatMessage.findUnique.mockResolvedValue(null);
    expect(await chat.toggleChatReaction({ messageId: MSG, emoji: "👍" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("sendChatMessage replies", () => {
  it("refuses a reply to another channel's message", async () => {
    db.chatMessage.findUnique.mockResolvedValue(message({ id: REPLY_TARGET, channelId: OTHER_CHANNEL }));
    const res = await chat.sendChatMessage({ channelId: CHANNEL, body: "re", replyToId: REPLY_TARGET });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(db.chatMessage.create).not.toHaveBeenCalled();
  });

  it("refuses a reply to a removed message", async () => {
    db.chatMessage.findUnique.mockResolvedValue(message({ id: REPLY_TARGET, deletedAt: new Date() }));
    const res = await chat.sendChatMessage({ channelId: CHANNEL, body: "re", replyToId: REPLY_TARGET });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("stores a same-channel reply and publishes", async () => {
    db.chatMessage.findUnique.mockResolvedValue(message({ id: REPLY_TARGET }));
    const res = await chat.sendChatMessage({ channelId: CHANNEL, body: "re", replyToId: REPLY_TARGET });
    expect(res).toMatchObject({ ok: true, data: { id: "new-msg" } });
    expect(db.chatMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ replyToId: REPLY_TARGET }) })
    );
    expect(publishRoomEvent).toHaveBeenCalledWith(CHANNEL, expect.objectContaining({ type: "message.created", messageId: "new-msg" }));
  });
});

describe("editChatMessage", () => {
  it("refuses editing another author's message", async () => {
    db.chatMessage.findUnique.mockResolvedValue(message({ authorId: "someone-else" }));
    expect(await chat.editChatMessage({ messageId: MSG, body: "x" })).toMatchObject({ ok: false });
    expect(db.chatMessage.update).not.toHaveBeenCalled();
  });

  it("refuses editing after 15 minutes", async () => {
    db.chatMessage.findUnique.mockResolvedValue(message({ createdAt: new Date(Date.now() - 16 * 60_000) }));
    const res = await chat.editChatMessage({ messageId: MSG, body: "x" });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED", error: "This message can no longer be edited" });
    expect(db.chatMessage.update).not.toHaveBeenCalled();
  });

  it("refuses editing a deleted message", async () => {
    db.chatMessage.findUnique.mockResolvedValue(message({ deletedAt: new Date(), body: "" }));
    expect(await chat.editChatMessage({ messageId: MSG, body: "x" })).toMatchObject({ ok: false });
    expect(db.chatMessage.update).not.toHaveBeenCalled();
  });

  it("saves the text with editedAt and publishes", async () => {
    const res = await chat.editChatMessage({ messageId: MSG, body: "fixed" });
    expect(res).toMatchObject({ ok: true });
    expect(db.chatMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MSG }, data: expect.objectContaining({ body: "fixed", editedAt: expect.any(Date) }) })
    );
    expect(publishRoomEvent).toHaveBeenCalledWith(CHANNEL, expect.objectContaining({ type: "message.updated", messageId: MSG }));
  });

  it("edit notifies only newly added mentions", async () => {
    db.user.findMany.mockResolvedValueOnce([
      { id: "old-1", role: "TEACHER" },
      { id: "new-1", role: "TEACHER" },
    ]);
    db.chatMention.findMany.mockResolvedValueOnce([{ userId: "old-1" }]);
    await chat.editChatMessage({ messageId: MSG, body: "hi @old @new" });
    expect(db.chatMention.createMany).toHaveBeenCalledWith({ data: [{ messageId: MSG, userId: "new-1" }] });
    expect(db.notification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ recipientId: "new-1", type: "CHAT_MENTION", channelId: CHANNEL })],
    });
  });
});

describe("deleteChatMessage", () => {
  it("delete blanks body and removes reactions and mentions in one transaction", async () => {
    const res = await chat.deleteChatMessage({ messageId: MSG });
    expect(res).toMatchObject({ ok: true });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.chatReaction.deleteMany).toHaveBeenCalledWith({ where: { messageId: MSG } });
    expect(db.chatMention.deleteMany).toHaveBeenCalledWith({ where: { messageId: MSG } });
    expect(db.chatMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MSG }, data: { body: "", deletedAt: expect.any(Date) } })
    );
    expect(writeAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: "CHAT_MESSAGE_MODERATE" }));
    expect(publishRoomEvent).toHaveBeenCalledWith(CHANNEL, expect.objectContaining({ type: "message.updated" }));
  });

  it("teacher may not delete another's message", async () => {
    db.chatMessage.findUnique.mockResolvedValue(message({ authorId: "someone-else" }));
    expect(await chat.deleteChatMessage({ messageId: MSG })).toMatchObject({ ok: false });
    expect(db.chatMessage.update).not.toHaveBeenCalled();
  });

  it("super admin may delete any message and it is audited without text", async () => {
    requireUser.mockResolvedValue(admin);
    db.chatMessage.findUnique.mockResolvedValue(message({ authorId: "someone-else", body: "secret words" }));
    expect(await chat.deleteChatMessage({ messageId: MSG })).toMatchObject({ ok: true });
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "CHAT_MESSAGE_MODERATE", resourceId: MSG, userId: admin.id })
    );
    expect(JSON.stringify(writeAudit.mock.calls)).not.toContain("secret words");
  });
});

describe("toggleChatReaction", () => {
  it("toggle adds then removes", async () => {
    db.chatReaction.findUnique.mockResolvedValueOnce(null);
    expect(await chat.toggleChatReaction({ messageId: MSG, emoji: "❤️" })).toMatchObject({ ok: true, data: { on: true } });
    expect(db.chatReaction.create).toHaveBeenCalledWith({ data: { messageId: MSG, userId: teacher.id, emoji: "❤️" } });

    db.chatReaction.findUnique.mockResolvedValueOnce({ id: "r1" });
    expect(await chat.toggleChatReaction({ messageId: MSG, emoji: "❤️" })).toMatchObject({ ok: true, data: { on: false } });
    expect(db.chatReaction.delete).toHaveBeenCalledWith({ where: { id: "r1" } });
    expect(publishRoomEvent).toHaveBeenCalledWith(CHANNEL, expect.objectContaining({ type: "reaction.changed", messageId: MSG }));
  });

  it("rejects an emoji outside the six", async () => {
    expect(await chat.toggleChatReaction({ messageId: MSG, emoji: "🔥" })).toMatchObject({ ok: false });
    expect(db.chatReaction.create).not.toHaveBeenCalled();
  });

  it("refuses a reaction on a removed message", async () => {
    db.chatMessage.findUnique.mockResolvedValue(message({ deletedAt: new Date(), body: "" }));
    expect(await chat.toggleChatReaction({ messageId: MSG, emoji: "👍" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("readChannel view", () => {
  const authorRow = (u: typeof teacher) => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, fullName: null, username: u.username, role: u.role });

  function seedRead() {
    db.chatMessage.findMany.mockResolvedValueOnce([
      {
        id: MSG,
        body: "",
        createdAt: new Date(),
        deletedAt: new Date(),
        editedAt: null,
        authorId: teacher.id,
        author: authorRow(teacher),
        mentions: [],
        reactions: [],
        replyTo: null,
      },
    ] as never);
    db.chatRead.findMany.mockResolvedValueOnce([
      { userId: "head-1", lastReadAt: new Date(), user: { firstName: "Ben", lastName: "Reyes", fullName: null, role: "SCHOOL_HEAD" } },
      { userId: admin.id, lastReadAt: new Date(), user: { firstName: "Dee", lastName: "Admin", fullName: null, role: "SUPER_ADMIN" } },
    ] as never);
    db.user.findMany.mockResolvedValueOnce([
      { id: "head-1", firstName: "Ben", lastName: "Reyes", fullName: null, role: "SCHOOL_HEAD", lastOnlineAt: new Date() },
      { id: admin.id, firstName: "Dee", lastName: "Admin", fullName: null, role: "SUPER_ADMIN", lastOnlineAt: new Date() },
    ] as never);
  }

  it("readChannel hides super admin from members and readers for a teacher", async () => {
    seedRead();
    const res = await chat.readChannel({ channelId: CHANNEL });
    if (!res.ok || !res.data) throw new Error("expected data");
    expect(res.data.readers.map((r) => r.userId)).toEqual(["head-1"]);
    expect(res.data.members.map((m) => m.userId)).toEqual(["head-1"]);
    expect(res.data.viewerIsAdmin).toBe(false);
    expect(res.data.viewerId).toBe(teacher.id);
  });

  it("readChannel shows super admin to an admin", async () => {
    requireUser.mockResolvedValue(admin);
    seedRead();
    const res = await chat.readChannel({ channelId: CHANNEL });
    if (!res.ok || !res.data) throw new Error("expected data");
    expect(res.data.readers.map((r) => r.userId).sort()).toEqual(["admin-1", "head-1"].sort());
  });

  it("deleted message view has empty body and deleted true", async () => {
    seedRead();
    const res = await chat.readChannel({ channelId: CHANNEL });
    if (!res.ok || !res.data) throw new Error("expected data");
    expect(res.data.messages[0]).toMatchObject({ id: MSG, body: "", deleted: true, reactions: [], replyTo: null });
  });
});

describe("markChannelRead", () => {
  it("publishes a member's read", async () => {
    await chat.markChannelRead({ channelId: CHANNEL });
    expect(publishRoomEvent).toHaveBeenCalledWith(CHANNEL, expect.objectContaining({ type: "read.changed", userId: teacher.id }));
  });

  it("super admin read publishes nothing", async () => {
    requireUser.mockResolvedValue(admin);
    await chat.markChannelRead({ channelId: CHANNEL });
    expect(publishRoomEvent).not.toHaveBeenCalled();
  });
});

describe("openChatSocket", () => {
  it("openChatSocket returns live false without binding", async () => {
    expect(await chat.openChatSocket({ channelId: CHANNEL })).toEqual({ ok: true, data: { live: false } });
  });

  it("returns live false without a secret", async () => {
    hasChatRoomBinding.mockReturnValue(true);
    chatSocketSecret.mockReturnValue(null);
    expect(await chat.openChatSocket({ channelId: CHANNEL })).toEqual({ ok: true, data: { live: false } });
  });

  it("openChatSocket ticket carries channel, user and admin flag", async () => {
    hasChatRoomBinding.mockReturnValue(true);
    requireUser.mockResolvedValue(admin);
    const res = await chat.openChatSocket({ channelId: CHANNEL });
    if (!res.ok || !res.data || !res.data.live) throw new Error("expected live ticket");
    expect(res.data.url).toBe("/chat-ws");
    const claims = await verifyTicket(res.data.ticket, "socket-secret");
    expect(claims).toMatchObject({ c: CHANNEL, u: admin.id, n: "Dee Admin", i: "DA", r: "SUPER_ADMIN" });
  });
});
