import "server-only";

/**
 * Minimal Upstash Redis REST client.
 *
 * Upstash speaks plain HTTP+JSON, so the official SDK buys us very little here
 * — we use a handful of commands and already degrade to a local fallback on
 * every failure. Talking to the REST API directly keeps the dependency count
 * at zero and keeps all failure handling in one visible place.
 *
 * Contract: every export returns `null` instead of throwing. Unconfigured,
 * unreachable, non-2xx, and malformed responses are all the same "no Redis"
 * signal, so callers have exactly one degraded path to handle rather than a
 * mix of nulls and exceptions.
 */

type Command = ReadonlyArray<string | number>;

/** Upstash wraps every reply as {result} or {error}. */
type UpstashReply = { result?: unknown; error?: string };

/** Abandon a Redis round-trip rather than let it add latency to a request. */
const REQUEST_TIMEOUT_MS = 1000;

function credentials(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

export function isUpstashConfigured(): boolean {
  return credentials() !== null;
}

async function post(path: string, body: unknown): Promise<unknown | null> {
  const creds = credentials();
  if (!creds) return null;

  // AbortSignal.timeout would be cleaner but keeps the request alive on
  // runtimes where it is unavailable; an explicit controller works everywhere.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(`${creds.url}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      // Next.js extends fetch with its own Data Cache. Caching a Redis reply
      // would defeat the point of consulting Redis at all.
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Run one command. Returns the raw `result`, or null on any failure. */
export async function upstashCommand(cmd: Command): Promise<unknown | null> {
  const json = (await post("", cmd)) as UpstashReply | null;
  if (!json || typeof json !== "object") return null;
  if (json.error) return null;
  return json.result ?? null;
}

/**
 * Run commands in one round-trip. Returns their `result`s positionally, or
 * null if the pipeline itself failed. Individual command errors become null
 * entries so one bad command does not discard the whole reply.
 */
export async function upstashPipeline(
  cmds: ReadonlyArray<Command>
): Promise<unknown[] | null> {
  if (cmds.length === 0) return [];
  const json = await post("/pipeline", cmds);
  if (!Array.isArray(json)) return null;
  return json.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const reply = entry as UpstashReply;
    return reply.error ? null : reply.result ?? null;
  });
}
