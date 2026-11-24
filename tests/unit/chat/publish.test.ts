import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getCloudflareContext = vi.fn();
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: (...a: unknown[]) => getCloudflareContext(...a),
}));

const { publishRoomEvent, hasChatRoomBinding } = await import("@/lib/chat/live/publish");

const EVENT = { type: "message.created" as const, messageId: "m1", at: "2026-11-24T00:00:00.000Z" };

function bindingWith(fetchImpl: (req: Request) => Promise<Response>) {
  const names: string[] = [];
  const fetches: Request[] = [];
  const CHAT_ROOM = {
    idFromName: (n: string) => {
      names.push(n);
      return n;
    },
    get: () => ({
      fetch: async (req: Request) => {
        fetches.push(req);
        return fetchImpl(req);
      },
    }),
  };
  getCloudflareContext.mockReturnValue({ env: { CHAT_ROOM } });
  return { names, fetches };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("publishRoomEvent", () => {
  it("no-op outside Cloudflare", async () => {
    getCloudflareContext.mockImplementation(() => {
      throw new Error("not in a request");
    });
    await expect(publishRoomEvent("c1", EVENT)).resolves.toBeUndefined();
    expect(hasChatRoomBinding()).toBe(false);
  });

  it("posts to the channel's room", async () => {
    const { names, fetches } = bindingWith(async () => new Response(null, { status: 204 }));
    await publishRoomEvent("chan-7", EVENT);
    expect(hasChatRoomBinding()).toBe(true);
    expect(names).toEqual(["chan-7"]);
    expect(fetches[0].method).toBe("POST");
    expect(new URL(fetches[0].url).pathname).toBe("/publish");
    expect(await fetches[0].json()).toEqual(EVENT);
  });

  it("swallows a throwing stub", async () => {
    bindingWith(async () => {
      throw new Error("room down");
    });
    await expect(publishRoomEvent("c1", EVENT)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("swallows a 500", async () => {
    bindingWith(async () => new Response("no", { status: 500 }));
    await expect(publishRoomEvent("c1", EVENT)).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalledWith("[chat] publish failed", "c1", 500);
  });
});
