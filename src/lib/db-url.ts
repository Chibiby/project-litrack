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
