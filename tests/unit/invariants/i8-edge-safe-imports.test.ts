import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT, importClosure } from "./source-scan";

/**
 * I8: middleware stays Edge-safe.
 *
 * `auth-cookies.ts` and `roles.ts` are what the Edge middleware imports to read
 * the role. Neither may reach Prisma, `server-only`, or any server-only part of
 * Better Auth, directly or through a chain of local imports: the Edge bundle
 * would fail to build, or worse, build with a database client it cannot use.
 * The rule also covers everything `src/middleware.ts` pulls in, because a
 * helper added there is just as fatal.
 *
 * `better-auth/cookies` (cookie parsing plus an HMAC check) is the one
 * Better Auth entry point allowed.
 */

/** Packages that must never be in the Edge graph. */
const FORBIDDEN_PACKAGE = [
  /^server-only$/,
  /^@prisma\//,
  /^prisma$/,
  /^pg$/,
  /^pg-/,
  /^next\/headers$/,
  /^react$/,
  /^bcryptjs$/,
  // The Better Auth core, adapters, plugins and Next bridge are server code.
  /^better-auth$/,
  /^better-auth\/(?!cookies$)/,
];

/** Local modules that are server-only by nature. */
const FORBIDDEN_LOCAL = [
  /^src\/lib\/prisma\.ts$/,
  /^src\/lib\/auth\/(?:better-auth|auth-session|identity|identity-rows|impersonation-session|password-reset|password-hash|session)\.ts$/,
  /^src\/lib\/db\/read-mode\.ts$/,
];

export type EdgeViolation = { entry: string; kind: "package" | "file"; what: string; via: string };

/** Check the import closure of each entry (paths relative to `root`) against the Edge rules. */
export function scanEdge(root: string, entries: string[]): EdgeViolation[] {
  const out: EdgeViolation[] = [];
  for (const entry of entries) {
    const { files, packages } = importClosure(root, path.join(root, entry));
    for (const [spec, via] of packages) {
      if (FORBIDDEN_PACKAGE.some((re) => re.test(spec))) out.push({ entry, kind: "package", what: spec, via });
    }
    for (const file of files) {
      if (FORBIDDEN_LOCAL.some((re) => re.test(file))) out.push({ entry, kind: "file", what: file, via: file });
    }
  }
  return out;
}

describe("I8 — the Edge middleware graph imports no Prisma and no server-only", () => {
  it("auth-cookies.ts and roles.ts have clean import closures", () => {
    expect(scanEdge(REPO_ROOT, ["src/lib/auth/auth-cookies.ts", "src/lib/auth/roles.ts"])).toEqual([]);
  });

  it("the whole middleware closure is clean too", () => {
    expect(scanEdge(REPO_ROOT, ["src/middleware.ts"])).toEqual([]);
  });

  it("the closure walk really reaches the files the middleware depends on", () => {
    const { files, packages } = importClosure(REPO_ROOT, path.join(REPO_ROOT, "src/middleware.ts"));
    expect(files).toEqual(
      expect.arrayContaining([
        "src/middleware.ts",
        "src/lib/auth/auth-cookies.ts",
        "src/lib/auth/roles.ts",
        "src/lib/auth/session-end.ts",
      ])
    );
    // The one Better Auth entry the Edge may use is actually the one it uses.
    expect([...packages.keys()]).toContain("better-auth/cookies");
  });

  it("neither Edge file carries a server-only marker or a Prisma import in its own source", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["src/lib/auth/auth-cookies.ts", "src/lib/auth/roles.ts"]) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      expect(source, file).not.toMatch(/["']server-only["']/);
      expect(source, file).not.toMatch(/@prisma\/client|@\/lib\/prisma/);
    }
  });
});

describe("I8 fixtures — the scanner fails when the invariant is broken", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "i8-"));
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

  it("flags a direct server-only import", () => {
    const root = tree({ "src/lib/auth/roles.ts": 'import "server-only";\nexport const x = 1;\n' });
    expect(scanEdge(root, ["src/lib/auth/roles.ts"])).toEqual([
      expect.objectContaining({ kind: "package", what: "server-only" }),
    ]);
  });

  it("flags Prisma reached through a chain of local imports", () => {
    const root = tree({
      "src/lib/auth/auth-cookies.ts": 'import { helper } from "@/lib/auth/helper";\n',
      "src/lib/auth/helper.ts": 'import { prisma } from "@/lib/prisma";\nexport const helper = prisma;\n',
      "src/lib/prisma.ts": 'import { PrismaClient } from "@prisma/client";\nexport const prisma = new PrismaClient();\n',
    });
    const found = scanEdge(root, ["src/lib/auth/auth-cookies.ts"]);
    expect(found).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "file", what: "src/lib/prisma.ts" }),
        expect.objectContaining({ kind: "package", what: "@prisma/client" }),
      ])
    );
  });

  it("flags the server half of Better Auth, but not better-auth/cookies", () => {
    const bad = tree({ "src/m.ts": 'import { betterAuth } from "better-auth";\nimport { nextCookies } from "better-auth/next-js";\n' });
    expect(scanEdge(bad, ["src/m.ts"]).map((v) => v.what).sort()).toEqual(["better-auth", "better-auth/next-js"]);
    const ok = tree({ "src/m.ts": 'import { getCookieCache } from "better-auth/cookies";\n' });
    expect(scanEdge(ok, ["src/m.ts"])).toEqual([]);
  });

  it("ignores a type-only import of a server module, which TypeScript erases", () => {
    const root = tree({
      "src/m.ts": 'import type { Session } from "@/lib/auth/auth-session";\nexport type T = Session;\n',
      "src/lib/auth/auth-session.ts": 'import "server-only";\n',
    });
    expect(scanEdge(root, ["src/m.ts"])).toEqual([]);
  });
});
