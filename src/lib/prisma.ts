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

function createPrismaClient() {
  return new PrismaClient({
    // Skip "query" in normal `next dev` — it floods the terminal on every
    // navigation/report load. Opt in with PRISMA_LOG_QUERIES=1 when debugging SQL.
    log:
      process.env.NODE_ENV === "development"
        ? process.env.PRISMA_LOG_QUERIES === "1"
          ? ["query", "error", "warn"]
          : ["error", "warn"]
        : ["error"],
    ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
  });
}

/**
 * After `prisma generate` adds models, a process-global client created before
 * generate still runs but new delegates are `undefined` until recreate/restart.
 * Detect that in dev and rebuild so ARAL holiday / new models don't 500.
 */
function getPrismaClient(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (
    existing &&
    process.env.NODE_ENV === "development" &&
    typeof (existing as { attendanceDayMeta?: unknown }).attendanceDayMeta ===
      "undefined"
  ) {
    void existing.$disconnect().catch(() => {});
    globalForPrisma.prisma = undefined;
  }

  const client = globalForPrisma.prisma ?? createPrismaClient();
  // Cache in production too. Vercel reuses a warm lambda across invocations, so
  // re-instantiating would open a new pool of pooler connections per request.
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = getPrismaClient();
