import { afterEach, describe, expect, it, vi } from "vitest";
import { pollAdminConversations, pollChannel, reviveChatDates } from "@/lib/chat/poll-client";

/**
 * Chat polls go over GET (not server actions) so they neither queue ahead of the
 * person's own sends nor make Next re-render the whole page. JSON loses Dates,
 * which the thread and the inbox call `.getTime()` on.
 */

function respond(body: unknown, init: { status?: number; raw?: string } = {}) {
  const fetchMock = vi.fn(async () =>
    new Response(init.raw ?? JSON.stringify(body), { status: init.status ?? 200 })
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reviveChatDates", () => {
  it("turns the named date fields back into Dates", () => {
    const value = JSON.parse(
      JSON.stringify({ createdAt: "2026-11-24T10:00:00.000Z", lastOnlineAt: "2026-11-24T09:00:00.000Z" }),
      reviveChatDates
    );
    expect(value.createdAt).toBeInstanceOf(Date);
    expect(value.lastOnlineAt.getTime()).toBe(Date.parse("2026-11-24T09:00:00.000Z"));
  });

  it("leaves a message body that looks like a timestamp as text", () => {
    const value = JSON.parse(JSON.stringify({ body: "2026-11-24T10:00:00.000Z" }), reviveChatDates);
    expect(value.body).toBe("2026-11-24T10:00:00.000Z");
  });
});

describe("pollChannel", () => {
  it("GETs the channel route and returns the action result with Dates", async () => {
    const fetchMock = respond({
      ok: true,
      data: { messages: [{ id: "m1", body: "Hi", createdAt: "2026-11-24T10:00:00.000Z", editedAt: null }] },
    });
    const result = await pollChannel("chan 1");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat/channel?channelId=chan%201",
      expect.objectContaining({ cache: "no-store" })
    );
    expect(result.ok).toBe(true);
    const message = (result as { data: { messages: { createdAt: Date; editedAt: Date | null }[] } }).data.messages[0];
    expect(message.createdAt).toBeInstanceOf(Date);
    expect(message.editedAt).toBeNull();
  });

  it("passes an action failure through unchanged", async () => {
    respond({ ok: false, code: "NOT_FOUND", error: "Not found" });
    expect(await pollChannel("c")).toEqual({ ok: false, code: "NOT_FOUND", error: "Not found" });
  });

  it("turns a route error into a failure the poller tolerates", async () => {
    respond({ code: "DB_UNAVAILABLE", message: "The database is busy." }, { status: 503 });
    expect(await pollChannel("c")).toMatchObject({ ok: false, error: "The database is busy." });
  });

  it("turns an HTML sign-in page into a failure, not a crash", async () => {
    respond(null, { raw: "<!doctype html><html></html>" });
    expect(await pollChannel("c")).toMatchObject({ ok: false, error: "Could not load the conversation." });
  });

  it("turns a dropped connection into a failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }));
    expect(await pollChannel("c")).toMatchObject({ ok: false, code: "SERVER_UNREACHABLE" });
  });
});

describe("pollAdminConversations", () => {
  it("GETs the list route and revives lastMessageAt", async () => {
    respond({ ok: true, data: [{ schoolId: "s1", staffRoom: { lastMessageAt: "2026-11-24T10:00:00.000Z" } }] });
    const result = await pollAdminConversations();
    const row = (result as { data: { staffRoom: { lastMessageAt: Date } }[] }).data[0];
    expect(row.staffRoom.lastMessageAt).toBeInstanceOf(Date);
  });
});
