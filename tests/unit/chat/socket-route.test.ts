import { describe, expect, it, vi } from "vitest";
import { handleChatSocket } from "@/lib/chat/live/socket-route";
import { signTicket } from "@/lib/chat/live/ticket";

const SECRET = "route-secret";

function fakeNamespace() {
  const fetches: Request[] = [];
  const names: string[] = [];
  const ns = {
    idFromName: vi.fn((name: string) => {
      names.push(name);
      return { name };
    }),
    get: vi.fn(() => ({
      fetch: vi.fn(async (req: Request) => {
        fetches.push(req);
        return new Response("forwarded", { status: 200 });
      }),
    })),
  };
  return { ns, fetches, names };
}

async function ticketFor(channel: string, now = Date.now()) {
  return signTicket({ c: channel, u: "u1", n: "Ana", i: "AN", r: "MEMBER" }, SECRET, now);
}

function upgrade(url: string, extra: Record<string, string> = {}) {
  return new Request(url, { headers: { Upgrade: "websocket", ...extra } });
}

describe("handleChatSocket", () => {
  it("426 without Upgrade header", async () => {
    const { ns } = fakeNamespace();
    const res = await handleChatSocket(new Request("https://x/chat-ws?ticket=a"), { CHAT_ROOM: ns, BETTER_AUTH_SECRET: SECRET });
    expect(res.status).toBe(426);
  });

  it("404 without binding", async () => {
    const res = await handleChatSocket(upgrade(`https://x/chat-ws?ticket=${await ticketFor("c1")}`), { BETTER_AUTH_SECRET: SECRET });
    expect(res.status).toBe(404);
  });

  it("401 on missing/expired/forged ticket", async () => {
    const { ns } = fakeNamespace();
    const env = { CHAT_ROOM: ns, BETTER_AUTH_SECRET: SECRET };
    expect((await handleChatSocket(upgrade("https://x/chat-ws"), env)).status).toBe(401);
    const old = await ticketFor("c1", Date.now() - 120_000);
    expect((await handleChatSocket(upgrade(`https://x/chat-ws?ticket=${old}`), env)).status).toBe(401);
    const forged = await signTicket({ c: "c1", u: "u1", n: "A", i: "A", r: "MEMBER" }, "wrong-secret");
    expect((await handleChatSocket(upgrade(`https://x/chat-ws?ticket=${forged}`), env)).status).toBe(401);
    expect((await handleChatSocket(upgrade(`https://x/chat-ws?ticket=${await ticketFor("c1")}`), { CHAT_ROOM: ns })).status).toBe(401);
    expect(ns.get).not.toHaveBeenCalled();
  });

  it("forwards to the room named by the ticket channel", async () => {
    const { ns, fetches, names } = fakeNamespace();
    const res = await handleChatSocket(upgrade(`https://x/chat-ws?ticket=${await ticketFor("chan-9")}`), {
      CHAT_ROOM: ns,
      BETTER_AUTH_SECRET: SECRET,
    });
    expect(res.status).toBe(200);
    expect(names).toEqual(["chan-9"]);
    const identity = JSON.parse(fetches[0].headers.get("x-chat-identity") ?? "{}");
    expect(identity).toMatchObject({ userId: "u1", displayName: "Ana", initials: "AN", isAdmin: false });
    expect(fetches[0].headers.get("upgrade")).toBe("websocket");
  });

  it("drops a client-supplied x-chat-identity header", async () => {
    const { ns, fetches } = fakeNamespace();
    const spoof = JSON.stringify({ userId: "admin", displayName: "Admin", initials: "AD", isAdmin: true, joinedAt: 0 });
    await handleChatSocket(
      upgrade(`https://x/chat-ws?ticket=${await ticketFor("c1")}`, { "x-chat-identity": spoof }),
      { CHAT_ROOM: ns, BETTER_AUTH_SECRET: SECRET }
    );
    const identity = JSON.parse(fetches[0].headers.get("x-chat-identity") ?? "{}");
    expect(identity.userId).toBe("u1");
    expect(identity.isAdmin).toBe(false);
  });
});
