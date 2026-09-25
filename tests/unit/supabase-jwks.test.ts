import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEYS = { keys: [{ kid: "k1", kty: "EC", key_ops: ["verify"] }] };

let kvStore: Map<string, string>;
let kvPut: ReturnType<typeof vi.fn>;
let contextThrows = false;

vi.mock("@opennextjs/cloudflare/cloudflare-context", () => ({
  getCloudflareContext: () => {
    if (contextThrows) throw new Error("no request context");
    return {
      env: {
        NEXT_INC_CACHE_KV: {
          get: async (k: string) => kvStore.get(k) ?? null,
          put: (...args: unknown[]) => kvPut(...args),
        },
      },
    };
  },
}));

async function load() {
  vi.resetModules();
  return (await import("@/lib/supabase/jwks")).getSharedJwks;
}

describe("getSharedJwks", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    kvStore = new Map();
    kvPut = vi.fn(async (k: string, v: string) => {
      kvStore.set(k, v);
    });
    contextThrows = false;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LITRACK_DEPLOY_TARGET", "cloudflare");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fetches once, stores in KV, then serves later isolates from KV without fetching", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(KEYS), { status: 200 }));

    const first = await load();
    expect(await first("https://x.supabase.co", "anon")).toEqual(KEYS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(kvPut).toHaveBeenCalledWith(expect.any(String), JSON.stringify(KEYS), {
      expirationTtl: 600,
    });

    // A fresh isolate: empty module memo, warm KV.
    const second = await load();
    expect(await second("https://x.supabase.co", "anon")).toEqual(KEYS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns undefined (SDK fetches itself) when the key endpoint fails", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const get = await load();
    expect(await get("https://x.supabase.co", "anon")).toBeUndefined();
    expect(kvPut).not.toHaveBeenCalled();
  });

  it("treats an empty or corrupt key set as a miss", async () => {
    kvStore.set("litrack:supabase-jwks:v1", "{not json");
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ keys: [] }), { status: 200 }));
    const get = await load();
    expect(await get("https://x.supabase.co", "anon")).toBeUndefined();
  });

  it("never throws when there is no Workers context, and does not fetch", async () => {
    contextThrows = true;
    const get = await load();
    expect(await get("https://x.supabase.co", "anon")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a no-op outside the Cloudflare deploy target", async () => {
    vi.stubEnv("LITRACK_DEPLOY_TARGET", "vercel");
    const get = await load();
    expect(await get("https://x.supabase.co", "anon")).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
