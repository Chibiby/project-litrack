import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Supabase's transaction pooler (port 6543, PgBouncer) does not support named
 * prepared statements. Prisma uses them by default, which surfaces in prod as
 * PostgresError 42P05 "prepared statement \"sN\" already exists" once more than
 * one request reuses a pooled connection. Prisma's documented fix is appending
 * `pgbouncer=true` (plus a low `connection_limit`) to DATABASE_URL.
 *
 * We can't set Vercel env vars ourselves, so patch the URL defensively here:
 * a no-op when DATABASE_URL is absent, already correct, or not pooled on 6543
 * (e.g. a direct connection or the 5432 session pooler used for migrations).
 */
function resolvePooledDatabaseUrl(): string | undefined {
  const raw = process.env.DATABASE_URL;
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

const datasourceUrl = resolvePooledDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
  });

// Cache in production too. Vercel reuses a warm lambda across invocations, so
// re-instantiating would open a new pool of pooler connections per request.
globalForPrisma.prisma = prisma;
