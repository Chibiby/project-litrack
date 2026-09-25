import type { JWK } from "@supabase/supabase-js";
import { getCloudflareContext } from "@opennextjs/cloudflare/cloudflare-context";

/**
 * Supabase's public signing keys, shared across Worker isolates through KV.
 *
 * `auth.getClaims()` verifies the access token locally, but the SDK keeps the
 * key set in isolate memory only. On Workers, isolates come and go constantly,
 * so each fresh one fetched `/auth/v1/.well-known/jwks.json` again — about
 * 25k fetches a day, every one of them a billed Supabase log row. Handing the
 * key set to `getClaims({ jwks })` skips that fetch.
 *
 * Edge-safe (middleware imports it): no `server-only`, no Prisma. Every
 * failure returns `undefined`, which leaves the SDK to fetch the keys itself —
 * so this can only save requests, never break verification. A key rotation is
 * safe too: when the token's `kid` is missing from the set given here, the SDK
 * falls back to its own fetch.
 */

type JwkSet = { keys: JWK[] };

/** Matches the SDK's own in-memory TTL (10 minutes). */
const TTL_SECONDS = 600;
const KV_KEY = "litrack:supabase-jwks:v1";

let memo: { jwks: JwkSet; at: number } | null = null;

type KvLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
};

function kvBinding(): KvLike | null {
  if (process.env.LITRACK_DEPLOY_TARGET !== "cloudflare") return null;
  try {
    const { env } = getCloudflareContext();
    const kv = (env as { NEXT_INC_CACHE_KV?: KvLike }).NEXT_INC_CACHE_KV;
    return kv ?? null;
  } catch {
    // No Workers request context (build, Node tests).
    return null;
  }
}

function parseJwks(text: string): JwkSet | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as JwkSet).keys) &&
      (parsed as JwkSet).keys.length > 0
    ) {
      return parsed as JwkSet;
    }
  } catch {
    // Fall through: a corrupt entry is treated as a miss.
  }
  return null;
}

export async function getSharedJwks(
  supabaseUrl: string,
  anonKey: string
): Promise<JwkSet | undefined> {
  const now = Date.now();
  if (memo && now - memo.at < TTL_SECONDS * 1000) return memo.jwks;

  const kv = kvBinding();
  try {
    const cached = kv ? await kv.get(KV_KEY) : null;
    const fromKv = cached ? parseJwks(cached) : null;
    if (fromKv) {
      memo = { jwks: fromKv, at: now };
      return fromKv;
    }

    // Outside Workers the SDK's own isolate cache already does this job.
    if (!kv) return undefined;

    const res = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, {
      headers: { apikey: anonKey },
    });
    if (!res.ok) return undefined;
    const text = await res.text();
    const fetched = parseJwks(text);
    if (!fetched) return undefined;

    memo = { jwks: fetched, at: now };
    await kv.put(KV_KEY, text, { expirationTtl: TTL_SECONDS });
    return fetched;
  } catch (err) {
    console.error("[jwks] shared key cache unavailable, SDK will fetch:", err);
    return undefined;
  }
}
