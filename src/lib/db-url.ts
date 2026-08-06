/**
 * Normalize DATABASE_URL for Supabase's transaction pooler (port 6543 / PgBouncer).
 *
 * Pure function — no env reads or side effects. Callers pass the raw URL string.
 *
 * Used by `src/lib/prisma.ts`. Behavior mirrors scripts/check-pooler-url.mjs.
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
  if (!url.searchParams.has("connection_limit")) {
    url.searchParams.set("connection_limit", "1");
  }
  return url.toString();
}
