import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `assertChannelAccess` is the one gate every chat entry point passes through.
 * Since chat moved onto `action()`, a refusal is a thrown catalog `NOT_FOUND`
 * rather than a swallowed `catch { return "Not found" }`, so two things are
 * pinned here: a channel in another school reads exactly like a missing one
 * (no existence leak), and an unexpected failure is no longer disguised as
 * "Not found".
 */

const SCHOOL_ID = "school-1";
const OTHER_SCHOOL_ID = "school-2";
const USER_ID = "teacher-1";
const CHANNEL_ID = "11111111-1111-4111-8111-111111111111";

const chatChannelFindUnique = vi.fn();
const chatMessageFindMany = vi.fn(async () => []);
vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatChannel: { findUnique: (...a: unknown[]) => chatChannelFindUnique(...a) },
    chatMessage: { findMany: (...a: unknown[]) => chatMessageFindMany(...(a as [])) },
  },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), AUDIT_ACTIONS: { CHAT_MESSAGE_SEND: "CHAT_MESSAGE_SEND" } }));
vi.mock("@/lib/chat/notifications", () => ({ markChatNotificationsRead: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined }));

const reportError = vi.fn((..._a: unknown[]) => "E-TESTREF-CHAT");
vi.mock("@/lib/errors/report", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

const { readChannel } = await import("@/lib/actions/chat");

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: USER_ID, role: "TEACHER", schoolId: SCHOOL_ID });
});

describe("readChannel", () => {
  it("answers another school's channel exactly like a missing one", async () => {
    chatChannelFindUnique.mockResolvedValueOnce({
      id: CHANNEL_ID,
      kind: "SCHOOL",
      schoolId: OTHER_SCHOOL_ID,
      memberId: null,
      school: { name: "Other ES" },
    });
    const foreign = await readChannel({ channelId: CHANNEL_ID });

    chatChannelFindUnique.mockResolvedValueOnce(null);
    const missing = await readChannel({ channelId: CHANNEL_ID });

    expect(foreign).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(foreign).toEqual(missing);
    expect(JSON.stringify(foreign)).not.toContain("Other ES");
    expect(chatMessageFindMany).not.toHaveBeenCalled();
    // The foreign attempt is recorded as a refusal; the plain miss is not.
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NOT_FOUND", severity: "security" }),
      expect.anything()
    );
  });

  it("refuses another member's private admin thread the same way", async () => {
    chatChannelFindUnique.mockResolvedValueOnce({
      id: CHANNEL_ID,
      kind: "ADMIN_DIRECT",
      schoolId: SCHOOL_ID,
      memberId: "someone-else",
      school: { name: "Own ES" },
    });

    const res = await readChannel({ channelId: CHANNEL_ID });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(chatMessageFindMany).not.toHaveBeenCalled();
  });

  it("no longer disguises an unexpected failure as Not found", async () => {
    chatChannelFindUnique.mockRejectedValueOnce(new Error("connection terminated sb_secret_9f3a"));

    const res = await readChannel({ channelId: CHANNEL_ID });

    expect(res).toMatchObject({ ok: false, code: "INTERNAL_ERROR", ref: "E-TESTREF-CHAT" });
    expect(JSON.stringify(res)).not.toContain("sb_secret_9f3a");
  });
});
