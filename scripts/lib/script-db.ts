/**
 * Shared plumbing for the `scripts/*.ts` maintenance commands: getting env into
 * `process.env`, and getting a PrismaClient that can actually reach the database.
 *
 * Both concerns exist because of the same two environment facts:
 *
 *  - The repo has no `dotenv` dependency, so `npx tsx scripts/…` sees only what the
 *    shell already exported. On PowerShell that is a chore, and a half-exported shell
 *    is how you end up pointing a maintenance script at the wrong project.
 *  - `DIRECT_URL` (`db.<ref>.supabase.co:5432`) resolves to IPv6-only on Supabase
 *    projects without the paid IPv4 add-on. On such a network it is simply
 *    unreachable, and `DIRECT_URL || DATABASE_URL` picks it anyway because it is set.
 */
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { resolvePooledDatabaseUrl } from "../../src/lib/db-url";

/**
 * Fill `process.env` from a dotenv file, without overwriting anything already set —
 * an explicit `$env:DATABASE_URL` on the command line still wins. Returns the key
 * names found, never the values, so a script can prove what it loaded without
 * printing a credential into a terminal log.
 *
 * A missing file is not an error: a CI or shell-exported environment is equally valid.
 */
export function loadEnvFile(file = ".env.local"): string[] {
  const full = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(full)) return [];

  const names: string[] = [];
  for (const raw of fs.readFileSync(full, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
    names.push(key);
  }
  return names;
}

/**
 * Connect to the database, preferring the direct port and falling back to the
 * transaction pooler.
 *
 * The preference order is the right one for batch work — PgBouncer's transaction mode
 * forces Prisma to give up named prepared statements — but it is only a preference.
 * Reachability is *probed* rather than assumed, because `DIRECT_URL` being set says
 * nothing about whether this network can route to it (see the IPv6 note above), and a
 * script that dies on `P1001` when a working pooler URL sits right there in the same
 * env file is needlessly hard to run.
 *
 * Prints which env var it used. Never prints the URL: those carry the database password.
 */
export async function connectScriptPrisma(): Promise<PrismaClient> {
  const candidates: { label: string; url: string }[] = [];
  if (process.env.DIRECT_URL) {
    candidates.push({ label: "DIRECT_URL (direct)", url: process.env.DIRECT_URL });
  }
  // resolvePooledDatabaseUrl adds pgbouncer=true and floors connection_limit at 3.
  // It returns its input unchanged for a non-6543 port, so a DATABASE_URL that is
  // itself direct still works here — it is just a second chance at the same host.
  const pooled = resolvePooledDatabaseUrl(process.env.DATABASE_URL);
  if (pooled) candidates.push({ label: "DATABASE_URL (pooled)", url: pooled });

  if (candidates.length === 0) {
    throw new Error("Set DIRECT_URL (preferred) or DATABASE_URL");
  }

  const failures: string[] = [];
  for (const candidate of candidates) {
    const prisma = new PrismaClient({ datasources: { db: { url: candidate.url } } });
    try {
      // A trivial round trip: enough to prove the socket and the credentials, cheap
      // enough to throw away. Anything less and the failure surfaces mid-transaction.
      await prisma.$queryRaw`SELECT 1`;
      console.log(`connected via ${candidate.label}`);
      return prisma;
    } catch (err) {
      await prisma.$disconnect().catch(() => {});
      const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
      failures.push(`${candidate.label}: ${message}`);
    }
  }

  throw new Error(`could not reach the database.\n  ${failures.join("\n  ")}`);
}
