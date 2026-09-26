/**
 * Shared guard and env helpers for the QA-owned e2e specs under `e2e/`.
 *
 * All of this is opt-in, matching `playwright.config.ts` (no `webServer`):
 * start `npm run dev` yourself, or set `PLAYWRIGHT_BASE_URL`, before running
 * `npm run test:e2e`. Specs that use these helpers skip cleanly (via
 * `test.skip`) when a required env var or a saved persona session is
 * missing, rather than failing.
 *
 * Session files (`e2e/.auth/*.json`) are produced by `e2e/auth/login.mjs`
 * and `e2e/auth/persona.mjs` — see those files for how to mint them. They
 * are gitignored and never committed.
 */
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

/** Never point any e2e run at the production host. */
const PRODUCTION_HOST_FRAGMENT = "arallitrack.com";

/**
 * Throws if `PLAYWRIGHT_BASE_URL` looks like production. Call this once at
 * module scope (or in a `beforeAll`) in every spec that can mutate data or
 * that exercises tenancy — a thrown error fails loudly instead of a skipped
 * test quietly doing nothing, which is the point for this particular guard.
 */
export function assertNotProduction(): void {
  const base = process.env.PLAYWRIGHT_BASE_URL ?? "";
  if (base.toLowerCase().includes(PRODUCTION_HOST_FRAGMENT)) {
    throw new Error(
      `Refusing to run e2e tests against a production-looking URL (${base}). ` +
        `PLAYWRIGHT_BASE_URL must never point at ${PRODUCTION_HOST_FRAGMENT}.`
    );
  }
}

/** Repo root, assuming the process (and Playwright) runs from there — see CLAUDE.md. */
const ROOT = process.cwd();
export const AUTH_DIR = path.join(ROOT, "e2e", ".auth");

export type Persona = "super-admin" | "head" | "teacher" | "district" | "pending-teacher";

export function personaStatePath(persona: Persona): string {
  return path.join(AUTH_DIR, `${persona}.json`);
}

/** Whether a saved session file exists for this persona. */
export function hasPersonaSession(persona: Persona): boolean {
  return fs.existsSync(personaStatePath(persona));
}

/** Names of env vars that are unset (or empty) among the ones listed. */
export function missingEnv(names: string[]): string[] {
  return names.filter((name) => {
    const value = process.env[name];
    return value === undefined || value === "";
  });
}

async function isServerReachable(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
  const host = parsed.hostname;

  return new Promise((resolve) => {
    const socket = net.connect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.setTimeout(1500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * True when there is somewhere to point the browser at: either
 * `PLAYWRIGHT_BASE_URL` is set (trusted, not re-probed) or a local server
 * answers on the default `http://localhost:3000`.
 */
export async function shouldRunAgainstServer(): Promise<boolean> {
  if (process.env.PLAYWRIGHT_BASE_URL) return true;
  return isServerReachable("http://localhost:3000");
}

/**
 * Combined reason string for why a test relying on `envNames` and/or a
 * `persona` session should skip, or `null` when everything needed is present.
 * Does not check server reachability — callers that need that call
 * `shouldRunAgainstServer` separately (usually once, in `beforeAll`).
 */
export function skipReason(opts: { envNames?: string[]; persona?: Persona }): string | null {
  const reasons: string[] = [];
  const missing = missingEnv(opts.envNames ?? []);
  if (missing.length > 0) {
    reasons.push(`missing env: ${missing.join(", ")}`);
  }
  if (opts.persona && !hasPersonaSession(opts.persona)) {
    reasons.push(
      `no saved session for "${opts.persona}" persona (run node e2e/auth/login.mjs then node e2e/auth/persona.mjs ${opts.persona})`
    );
  }
  return reasons.length > 0 ? reasons.join("; ") : null;
}
