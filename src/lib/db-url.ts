/**
 * Normalize DATABASE_URL for Supabase's transaction pooler (port 6543 / PgBouncer).
 *
 * Pure function — no env reads or side effects. Callers pass the raw URL string.
 *
 * Used by `src/lib/prisma.ts`. Behavior mirrors scripts/check-pooler-url.mjs.
 * Soft-floors `connection_limit` of 1 → 3 so overlapping RSC work on a warm
 * isolate does not immediately Prisma-P2024 under teacher soft navigation.
 */
export function resolvePooledDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  if (url.port !== "6543") return raw;

  if (!url.searchParams.has("pgbouncer")) {
    url.searchParams.set("pgbouncer", "true");
  }
  // Soft floor of 3: a single warm Vercel isolate can serve overlapping RSC
  // navigations/prefetches. connection_limit=1 makes those waiters hit Prisma
  // P2024 ("Timed out fetching a new connection") and teacher/error.tsx.
  // Still low enough for PgBouncer + many serverless instances.
  const existingLimit = url.searchParams.get("connection_limit");
  if (!existingLimit || existingLimit === "1") {
    url.searchParams.set("connection_limit", "3");
  }
  return url.toString();
}

/**
 * Keep `sslmode=require` at its libpq meaning: encrypt the connection without
 * requiring a publicly trusted certificate chain. pg 8.23 otherwise treats it
 * as `verify-full`, while Supabase's pooler currently presents a self-signed
 * certificate chain and terminates the Workers TLS handshake.
 */
export function resolvePgDriverUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return raw;
  }

  if (url.searchParams.get("sslmode") !== "require") return raw;
  if (!url.searchParams.has("uselibpqcompat")) {
    url.searchParams.set("uselibpqcompat", "true");
  }
  return url.toString();
}

export type HyperdriveEnv = {
  HYPERDRIVE?: { connectionString?: string };
  HYPERDRIVE_FRESH?: { connectionString?: string };
};

/**
 * Which Hyperdrive binding a Prisma client connects through.
 *
 * `HYPERDRIVE` has query caching on: a read can return rows up to about a
 * minute old. That is fine for most pages and wrong for a screen that writes
 * and then re-reads what it just wrote — the School Head teachers workspace
 * showed a saved advisory or role as unchanged for a minute or more.
 * `HYPERDRIVE_FRESH` is a second Hyperdrive config on the same database with
 * caching disabled, which is Cloudflare's documented pattern for fresh reads.
 *
 * Falls back to `HYPERDRIVE` when the fresh binding is absent, so a Worker
 * deployed without it still connects.
 */
export function pickHyperdriveUrl(
  env: HyperdriveEnv,
  mode: "cached" | "fresh",
): string | undefined {
  const cached = env.HYPERDRIVE?.connectionString;
  return mode === "fresh"
    ? (env.HYPERDRIVE_FRESH?.connectionString ?? cached)
    : cached;
}

export function resolveRuntimeDatabaseUrl(
  deployTarget: string | undefined,
  hyperdriveUrl: string | undefined,
  environmentUrl: string | undefined,
): string | undefined {
  return deployTarget === "cloudflare" && hyperdriveUrl
    ? hyperdriveUrl
    : environmentUrl;
}
