import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The chat poll routes: signed-in only (Super Admin only for the inbox list),
 * and they answer exactly what the server action answers.
 */

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({ requireUser: (...a: unknown[]) => requireUser(...a) }));
const readChannel = vi.fn();
const listAdminConversations = vi.fn();
vi.mock("@/lib/actions/chat", () => ({
  readChannel: (...a: unknown[]) => readChannel(...a),
  listAdminConversations: () => listAdminConversations(),
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-REF") }));

const channelRoute = await import("@/app/api/chat/channel/route");
const listRoute = await import("@/app/api/chat/admin-conversations/route");

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ id: "u1", role: "TEACHER", schoolId: "s1" });
});

describe("GET /api/chat/channel", () => {
  it("checks the session, then returns readChannel's result uncached", async () => {
    readChannel.mockResolvedValue({ ok: true, data: { id: "c1", messages: [] } });
    const res = await channelRoute.GET(new NextRequest("http://localhost/api/chat/channel?channelId=c1"));
    expect(requireUser).toHaveBeenCalledWith();
    expect(readChannel).toHaveBeenCalledWith({ channelId: "c1" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, data: { id: "c1", messages: [] } });
  });

  it("reads nothing when the session check fails", async () => {
    requireUser.mockRejectedValue(new Error("boom"));
    const res = await channelRoute.GET(new NextRequest("http://localhost/api/chat/channel?channelId=c1"));
    expect(res.ok).toBe(false);
    expect(readChannel).not.toHaveBeenCalled();
  });
});

describe("GET /api/chat/admin-conversations", () => {
  it("is Super Admin only", async () => {
    listAdminConversations.mockResolvedValue({ ok: true, data: [] });
    const res = await listRoute.GET(new NextRequest("http://localhost/api/chat/admin-conversations"));
    expect(requireUser).toHaveBeenCalledWith(["SUPER_ADMIN"]);
    expect(await res.json()).toEqual({ ok: true, data: [] });
  });
});
