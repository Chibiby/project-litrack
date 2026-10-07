import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT, importRefs, read, rel, stripComments, walk, walkDirs } from "./source-scan";

/**
 * I6: no Better Auth HTTP surface.
 *
 * Every call is a server-side `getAuth().api.*` made from a wrapped action.
 * Mounting Better Auth's catch-all handler would expose sign-up, sign-in and
 * admin endpoints that bypass the school and approval gates, the app rate
 * limiter and the audit trail. Nothing may mount one, import a client for one,
 * or call `handler()` on the instance, and sign-up stays disabled as the
 * second lock.
 */

/** Packages that only exist to reach Better Auth over HTTP. */
const HTTP_ONLY_PACKAGE = /^better-auth\/(?:react|client|vue|solid|svelte|node|plugins\/.*-client)$/;

export type Violation = { file: string; rule: string };

/** Scan `<root>` for I6 violations in routes and source. */
export function scanI6(root: string): Violation[] {
  const out: Violation[] = [];

  // A route path through `api/auth` (App Router or Pages Router), or a
  // better-auth catch-all segment, is a mounted surface.
  for (const base of ["src/app", "src/pages", "pages", "app"]) {
    for (const dir of walkDirs(root, path.join(root, base))) {
      if (/(^|\/)api\/auth(\/|$)/.test(dir)) out.push({ file: dir, rule: "route directory under api/auth" });
      if (/\[\.\.\.(?:all|auth|betterauth|better-auth)\]/i.test(dir)) {
        out.push({ file: dir, rule: "catch-all route segment that could host the auth handler" });
      }
    }
  }

  for (const dirName of ["src", "scripts"]) {
    for (const abs of walk(path.join(root, dirName), /\.(?:ts|tsx|mts|mjs|js)$/)) {
      const file = rel(root, abs);
      const source = read(abs);
      const code = stripComments(source);
      if (/\btoNextJsHandler\b|\btoNodeHandler\b|\btoSvelteKitHandler\b|\btoSolidStartHandler\b/.test(code)) {
        out.push({ file, rule: "imports or uses a Better Auth route-handler adapter" });
      }
      if (/\bcreateAuthClient\b/.test(code)) out.push({ file, rule: "creates a Better Auth HTTP client" });
      if (/\b(?:getAuth\(\)|auth)\.handler\b/.test(code)) out.push({ file, rule: "calls the Better Auth request handler" });
      for (const ref of importRefs(source)) {
        if (HTTP_ONLY_PACKAGE.test(ref.spec)) out.push({ file, rule: `imports ${ref.spec}` });
      }
    }
  }
  return out;
}

describe("I6 — no Better Auth HTTP surface", () => {
  it("scans a substantial amount of source (guards against a scan that matches nothing)", () => {
    expect(walk(path.join(REPO_ROOT, "src"), /\.(?:ts|tsx)$/).length).toBeGreaterThan(300);
    expect(walkDirs(REPO_ROOT, path.join(REPO_ROOT, "src/app")).length).toBeGreaterThan(20);
  });

  it("has no src/app/api/auth directory, no toNextJsHandler, no auth client and no handler() call", () => {
    expect(scanI6(REPO_ROOT)).toEqual([]);
  });

  it("keeps self sign-up disabled in the Better Auth config", () => {
    const code = stripComments(read(path.join(REPO_ROOT, "src/lib/auth/better-auth.ts")));
    expect(code).toMatch(/emailAndPassword:\s*\{[^}]*disableSignUp:\s*true/);
  });

  it("only takes nextCookies from better-auth/next-js (the cookie bridge, not a handler)", () => {
    const refs = walk(path.join(REPO_ROOT, "src"), /\.(?:ts|tsx)$/).flatMap((abs) =>
      importRefs(read(abs))
        .filter((r) => r.spec === "better-auth/next-js")
        .map(() => rel(REPO_ROOT, abs))
    );
    expect(refs).toEqual(["src/lib/auth/better-auth.ts"]);
    const code = stripComments(read(path.join(REPO_ROOT, "src/lib/auth/better-auth.ts")));
    expect(code).toMatch(/import\s*\{\s*nextCookies\s*\}\s*from\s*["']better-auth\/next-js["']/);
  });
});

describe("I6 fixtures — the scanner fails when the invariant is broken", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "i6-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  function tree(files: Record<string, string>): string {
    const root = mkdtempSync(path.join(tmp, "t-"));
    for (const [name, body] of Object.entries(files)) {
      const full = path.join(root, name);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    return root;
  }

  it("flags the canonical mount: src/app/api/auth/[...all]/route.ts using toNextJsHandler", () => {
    const root = tree({
      "src/app/api/auth/[...all]/route.ts":
        'import { toNextJsHandler } from "better-auth/next-js";\nexport const { GET, POST } = toNextJsHandler(auth);\n',
    });
    const rules = scanI6(root).map((v) => v.rule);
    expect(rules).toContain("route directory under api/auth");
    expect(rules).toContain("catch-all route segment that could host the auth handler");
    expect(rules).toContain("imports or uses a Better Auth route-handler adapter");
  });

  it("flags a toNextJsHandler mounted anywhere else", () => {
    const root = tree({ "src/app/health/route.ts": "export const x = toNextJsHandler(a);\n" });
    expect(scanI6(root)).toHaveLength(1);
  });

  it("flags a browser client and a direct handler call", () => {
    const root = tree({
      "src/lib/client.ts": 'import { createAuthClient } from "better-auth/react";\nexport const c = createAuthClient();\n',
      "src/lib/wire.ts": "export const r = (req: Request) => getAuth().handler(req);\n",
    });
    const rules = scanI6(root).map((v) => v.rule);
    expect(rules).toContain("creates a Better Auth HTTP client");
    expect(rules).toContain("imports better-auth/react");
    expect(rules).toContain("calls the Better Auth request handler");
  });

  it("does not flag the unrelated api routes or prose in comments", () => {
    const root = tree({
      "src/app/api/cron/backup/route.ts": "export const GET = () => new Response('ok');\n",
      "src/lib/note.ts": "// never use toNextJsHandler here\nexport const ok = 1;\n",
    });
    expect(scanI6(root)).toEqual([]);
  });
});
