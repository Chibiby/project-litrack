// Paths and env shared by the local e2e session helpers. See login.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const AUTH_DIR = path.join(ROOT, "e2e", ".auth");
export const SUPER_ADMIN_STATE = path.join(AUTH_DIR, "super-admin.json");
export const personaStatePath = (persona) => path.join(AUTH_DIR, `${persona}.json`);

/** `.env.e2e` values, with real environment variables taking precedence. */
export function loadE2eEnv() {
  const out = {};
  const file = path.join(ROOT, ".env.e2e");
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("LITRACK_E2E_") || key === "PLAYWRIGHT_BASE_URL") out[key] = process.env[key];
  }
  return out;
}

export function resolveBaseUrl(env) {
  const base = (env.LITRACK_E2E_BASE_URL || env.PLAYWRIGHT_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  const host = new URL(base).hostname;
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  if (!local && env.LITRACK_E2E_ALLOW_REMOTE !== "1") {
    throw new Error(`Refusing non-local base URL ${base}. Set LITRACK_E2E_ALLOW_REMOTE=1 for a staging host; never production.`);
  }
  return base;
}
