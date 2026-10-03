#!/usr/bin/env node
/**
 * Opt-in, LOCAL-ONLY database test lane (`npm run test:db`).
 *
 * Creates (once) and starts a throwaway PostgreSQL cluster on 127.0.0.1:54329,
 * rebuilds the `litrack_test` database from every committed migration, runs
 * `vitest run --config vitest.db.config.ts` against it, then stops the cluster.
 *
 * It never reads DATABASE_URL / DIRECT_URL from the environment or any .env
 * file: the URL is built here from constants and handed to the vitest child
 * only. A guard refuses to run if that URL is not loopback.
 *
 * Prerequisite: PostgreSQL binaries (scoop install postgresql). Override the
 * bin directory with LITRACK_TEST_PG_BIN. Port 5432 is deliberately avoided.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = "127.0.0.1";
const PORT = 54329;
const DB_NAME = "litrack_test";
const SUPERUSER = "postgres";

const BIN_DIR =
  process.env.LITRACK_TEST_PG_BIN ??
  path.join(os.homedir(), "scoop", "apps", "postgresql", "current", "bin");
const BASE_DIR = path.join(
  process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"),
  "litrack-test-pg",
);
const DATA_DIR = path.join(BASE_DIR, "data");
const LOG_FILE = path.join(BASE_DIR, "server.log");

const exe = (name) => path.join(BIN_DIR, process.platform === "win32" ? `${name}.exe` : name);

const DATABASE_URL = `postgresql://${SUPERUSER}@${HOST}:${PORT}/${DB_NAME}`;
const ADMIN_URL = `postgresql://${SUPERUSER}@${HOST}:${PORT}/postgres`;

function assertLocal(url) {
  const { hostname } = new URL(url);
  if (hostname !== "127.0.0.1" && hostname !== "localhost") {
    throw new Error(`Refusing to run: database host "${hostname}" is not local.`);
  }
}

function pgCtl(args, opts = {}) {
  return spawnSync(exe("pg_ctl"), ["-D", DATA_DIR, ...args], { encoding: "utf8", ...opts });
}

function ensureCluster() {
  if (!existsSync(exe("initdb"))) {
    throw new Error(
      `PostgreSQL binaries not found in ${BIN_DIR}. Install with "scoop install postgresql" or set LITRACK_TEST_PG_BIN.`,
    );
  }
  if (!existsSync(path.join(DATA_DIR, "PG_VERSION"))) {
    mkdirSync(BASE_DIR, { recursive: true });
    console.log(`[test-db] initdb -> ${DATA_DIR}`);
    const init = spawnSync(
      exe("initdb"),
      ["-D", DATA_DIR, "-U", SUPERUSER, "-A", "trust", "-E", "UTF8", "--no-locale"],
      { encoding: "utf8" },
    );
    if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr || init.stdout}`);
  }
}

// True only when THIS run started the cluster; a cluster that was already
// running belongs to someone else and must be left running.
let startedByThisRun = false;

function startCluster() {
  if (pgCtl(["status"]).status === 0) {
    console.log("[test-db] cluster already running (left running afterwards)");
    return;
  }
  console.log(`[test-db] starting cluster on ${HOST}:${PORT}`);
  // stdio "ignore": on Windows the detached postgres process would otherwise
  // hold our pipes open and make this call hang.
  const res = pgCtl(
    ["-w", "-l", LOG_FILE, "-o", `-p ${PORT} -c listen_addresses=${HOST}`, "start"],
    { stdio: "ignore" },
  );
  if (res.status !== 0) throw new Error(`pg_ctl start failed (see ${LOG_FILE})`);
  startedByThisRun = true;
}

function stopCluster() {
  if (!startedByThisRun) return;
  if (pgCtl(["status"]).status !== 0) return;
  console.log("[test-db] stopping cluster");
  pgCtl(["-m", "fast", "-w", "stop"], { stdio: "ignore" });
}

async function recreateDatabase() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
  } finally {
    await admin.end();
  }
}

// Test-only stand-ins for what Supabase provides. Migration
// 20260915000007 references role `authenticated` and `auth.uid()`. Never shipped.
const SUPABASE_STUB = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
`;

async function applyMigrations() {
  const dir = path.join(ROOT, "prisma", "migrations");
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(dir, d.name, "migration.sql")))
    .map((d) => d.name)
    .sort();
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(SUPABASE_STUB);
    for (const name of names) {
      const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`migration ${name} failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log(`[test-db] applied ${names.length} migrations`);
  } finally {
    await client.end();
  }
}

function runVitest() {
  const vitest = path.join(ROOT, "node_modules", "vitest", "vitest.mjs");
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [vitest, "run", "--config", "vitest.db.config.ts", ...process.argv.slice(2)],
      {
        cwd: ROOT,
        stdio: "inherit",
        // The only place the URL exists: the child's own environment.
        env: {
          ...process.env,
          DATABASE_URL,
          DIRECT_URL: DATABASE_URL,
          // Marker tests/db/helpers.ts requires before it will TRUNCATE anything.
          LITRACK_TEST_DB_LANE: "1",
        },
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main() {
  assertLocal(DATABASE_URL);
  assertLocal(ADMIN_URL);
  let code = 1;
  try {
    ensureCluster();
    startCluster();
    await recreateDatabase();
    await applyMigrations();
    code = await runVitest();
  } catch (err) {
    console.error(`[test-db] ${err instanceof Error ? err.message : err}`);
  } finally {
    stopCluster();
  }
  process.exit(code);
}

main();
