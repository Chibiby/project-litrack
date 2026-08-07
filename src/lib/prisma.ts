import { PrismaClient } from "@prisma/client";
import { getServerEnv } from "@/lib/env";
import { resolvePooledDatabaseUrl } from "@/lib/db-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Supabase's transaction pooler (port 6543, PgBouncer) does not support named
 * prepared statements. Prisma uses them by default, which surfaces in prod as
 * PostgresError 42P05 "prepared statement \"sN\" already exists" once more than
 * one request reuses a pooled connection. Prisma's documented fix is appending
 * `pgbouncer=true` (plus a low `connection_limit`, default 3) to DATABASE_URL.
 *
 * We can't set Vercel env vars ourselves, so patch the URL defensively here:
 * a no-op when DATABASE_URL is absent, already correct, or not pooled on 6543
 * (e.g. a direct connection or the 5432 session pooler used for migrations).
 *
 * Prefers validated env via getServerEnv(); falls back to process.env so module
 * load / build without full env still constructs a client (queries fail later).
 * Soft Supabase helpers in supabase/env.ts are unchanged for middleware.
 */
function readDatabaseUrl(): string | undefined {
  try {
    return getServerEnv().DATABASE_URL;
  } catch {
    return process.env.DATABASE_URL;
  }
}

const datasourceUrl = resolvePooledDatabaseUrl(readDatabaseUrl());

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
    ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
  });

// Cache in production too. Vercel reuses a warm lambda across invocations, so
// re-instantiating would open a new pool of pooler connections per request.
globalForPrisma.prisma = prisma;
