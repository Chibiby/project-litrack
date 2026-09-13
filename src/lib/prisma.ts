import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { cache } from "react";
import { getServerEnv } from "@/lib/env";
import {
  resolvePgDriverUrl,
  resolvePooledDatabaseUrl,
  resolveRuntimeDatabaseUrl,
} from "@/lib/db-url";

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
  let environmentUrl: string | undefined;
  try {
    environmentUrl = getServerEnv().DATABASE_URL;
  } catch {
    environmentUrl = process.env.DATABASE_URL;
  }

  let hyperdriveUrl: string | undefined;
  if (process.env.LITRACK_DEPLOY_TARGET === "cloudflare") {
    try {
      const { env } = getCloudflareContext();
      hyperdriveUrl = (
        env as unknown as {
          HYPERDRIVE?: { connectionString?: string };
        }
      ).HYPERDRIVE?.connectionString;
    } catch {
      // Builds and Node-based tests do not have a Workers request context.
    }
  }

  return resolveRuntimeDatabaseUrl(
    process.env.LITRACK_DEPLOY_TARGET,
    hyperdriveUrl,
    environmentUrl,
  );
}

const datasourceUrl = resolvePooledDatabaseUrl(readDatabaseUrl());

// Prisma's JavaScript engine requires a driver adapter at construction time,
// including during builds and unit tests that never issue a query. A closed
// localhost port keeps that no-env fallback deterministic and unable to reach
// a real database; production requests still fail through the app's normal
// environment validation before querying it.
const UNCONFIGURED_DATABASE_URL =
  "postgresql://unconfigured:unconfigured@127.0.0.1:1/unconfigured";

export function createPrismaClient(databaseUrl = datasourceUrl) {
  const adapter = new PrismaPg({
    connectionString:
      resolvePgDriverUrl(databaseUrl) ?? UNCONFIGURED_DATABASE_URL,
    // Workers forbid reusing an I/O object from a previous request. Retire a
    // pool connection after one use so a warm isolate cannot carry its socket
    // into the next request; Supabase's transaction pooler handles reuse on
    // the database side.
    maxUses: 1,
  });

  return new PrismaClient({
    adapter,
    // Skip "query" in normal `next dev` — it floods the terminal on every
    // navigation/report load. Opt in with PRISMA_LOG_QUERIES=1 when debugging SQL.
    log:
      process.env.NODE_ENV === "development"
        ? process.env.PRISMA_LOG_QUERIES === "1"
          ? ["query", "error", "warn"]
          : ["error", "warn"]
        : ["error"],
  });
}

export function createPrismaProxy(getClient: () => PrismaClient): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_target, property) {
      const client = getClient();
      const value = Reflect.get(client, property, client) as unknown;
      return typeof value === "function" ? value.bind(client) : value;
    },
  });
}

// React's request cache gives each Cloudflare request its own Prisma client and
// pool. Creating either at module scope would attach pg sockets/promises to the
// isolate's startup context, which workerd rejects when a request later uses
// them. Outside a React Server Component, cache() simply provides no reuse;
// the lazy proxy still constructs the client only when a query is attempted.
const getCloudflarePrismaClient = cache(() => createPrismaClient());

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

export const prisma =
  process.env.LITRACK_DEPLOY_TARGET === "cloudflare"
    ? createPrismaProxy(getCloudflarePrismaClient)
    : getPrismaClient();
