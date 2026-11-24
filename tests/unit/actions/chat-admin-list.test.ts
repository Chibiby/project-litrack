import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Support hub's 10 s poll reads only the conversation list through this
 * action, instead of re-rendering the whole page (tickets, email recipients
 * and the open transcript) every time.
 */

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: (...a: unknown[]) => requireUser(...a) }));
const listAdminChatSchools = vi.fn();
vi.mock("@/lib/chat/queries", () => ({ listAdminChatSchools: (...a: unknown[]) => listAdminChatSchools(...a) }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(), AUDIT_ACTIONS: {} }));
vi.mock("@/lib/chat/notifications", () => ({ markChatNotificationsRead: vi.fn() }));
vi.mock("@/lib/chat/live/publish", () => ({
  publishRoomEvent: vi.fn(),
  hasChatRoomBinding: vi.fn(() => false),
  chatSocketSecret: vi.fn(() => null),
}));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => undefined }));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-REF") }));

const chat = await import("@/lib/actions/chat");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAdminConversations", () => {
  it("is Super Admin only and returns this admin's conversation list", async () => {
    requireUser.mockResolvedValue({ id: "admin-1", role: "SUPER_ADMIN", schoolId: null });
    listAdminChatSchools.mockResolvedValue([{ schoolId: "s1", schoolName: "North ES", isDemoSchool: false, staffRoom: null, directThreads: [] }]);
    const res = await chat.listAdminConversations();
    expect(requireUser).toHaveBeenCalledWith(["SUPER_ADMIN"]);
    expect(listAdminChatSchools).toHaveBeenCalledWith("admin-1");
    expect(res).toMatchObject({ ok: true, data: [expect.objectContaining({ schoolId: "s1" })] });
  });

  it("returns nothing when the role gate refuses", async () => {
    requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    const res = await chat.listAdminConversations();
    expect(res.ok).toBe(false);
    expect(listAdminChatSchools).not.toHaveBeenCalled();
  });
});
