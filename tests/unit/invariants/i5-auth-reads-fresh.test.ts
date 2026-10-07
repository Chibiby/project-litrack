import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT, importRefs, read, rel, stripComments, walk } from "./source-scan";

/**
 * I5: session and credential reads never come from the Hyperdrive cache.
 *
 * `prisma` (the cached client) must never touch an `Auth*` model; only
 * `prismaFresh` may, and only inside the five modules that own identity,
 * sessions and reset tokens. A session deleted by sign-out or
 * `stopImpersonating` would otherwise come back from the 60-second query cache
 * (risk R3). Scripts run their own client against the database directly and
 * are outside the rule.
 */

/** The only src files allowed to name an Auth* model. */
export const AUTH_MODEL_OWNERS = [
  "src/lib/auth/better-auth.ts",
  "src/lib/auth/identity.ts",
  "src/lib/auth/password-reset.ts",
  "src/lib/auth/auth-session.ts",
  "src/lib/auth/backfill-plan.ts",
];

const AUTH_DELEGATE = /\.auth(?:User|Session|Account|Verification)\b/;
const CACHED_AUTH_DELEGATE = /\bprisma\.auth(?:User|Session|Account|Verification)\b/;
/**
 * A quoted Auth* table name in a SQL position (`from "AuthUser"`, `join ...`),
 * not a bare string that merely names the model, as the schema-order registry does.
 */
const AUTH_TABLE_SQL =
  /\b(?:from|join|into|update|table|truncate)\s+(?:"public"\.)?"Auth(?:User|Session|Account|Verification)"/i;

export type Violation = { file: string; rule: string; line: number };

function lineOf(code: string, index: number): number {
  return code.slice(0, index).split("\n").length;
}

/** Scan `<root>/src` for I5 violations. Pure of the real repo so fixtures can reuse it. */
export function scanI5(root: string): Violation[] {
  const violations: Violation[] = [];
  for (const abs of walk(path.join(root, "src"), /\.(?:ts|tsx)$/)) {
    const file = rel(root, abs);
    const code = stripComments(read(abs));

    const cached = CACHED_AUTH_DELEGATE.exec(code);
    if (cached) violations.push({ file, rule: "cached prisma client used on an Auth* model", line: lineOf(code, cached.index) });

    if (!AUTH_MODEL_OWNERS.includes(file)) {
      for (const [pattern, rule] of [
        [AUTH_DELEGATE, "Auth* model delegate outside the owner modules"],
        [AUTH_TABLE_SQL, "Auth* table in raw SQL outside the owner modules"],
      ] as const) {
        const m = pattern.exec(code);
        if (m) violations.push({ file, rule, line: lineOf(code, m.index) });
      }
    }

    if (AUTH_MODEL_OWNERS.includes(file)) {
      // An owner may import only `prismaFresh` from the prisma module: a bare
      // `prisma` import in these files is how a cached read would creep in.
      for (const m of code.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/prisma["']/g)) {
        const names = m[1].split(",").map((s) => s.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]).filter(Boolean);
        const bad = names.filter((n) => n !== "prismaFresh");
        if (bad.length > 0) {
          violations.push({ file, rule: `imports ${bad.join(", ")} from @/lib/prisma (only prismaFresh allowed)`, line: lineOf(code, m.index ?? 0) });
        }
      }
    }
  }
  return violations;
}

describe("I5 — Auth* models are read only through prismaFresh, only in the owner modules", () => {
  it("the owner modules exist (guards against an allow-list that points at nothing)", () => {
    for (const file of AUTH_MODEL_OWNERS) {
      expect(() => read(path.join(REPO_ROOT, file)), file).not.toThrow();
    }
    expect(walk(path.join(REPO_ROOT, "src"), /\.(?:ts|tsx)$/).length).toBeGreaterThan(300);
  });

  it("no src file touches an Auth* model outside the owner modules, and none through the cached client", () => {
    expect(scanI5(REPO_ROOT)).toEqual([]);
  });

  it("the Better Auth adapter is built on prismaFresh, not the cached client", () => {
    const code = stripComments(read(path.join(REPO_ROOT, "src/lib/auth/better-auth.ts")));
    expect(code).toMatch(/prismaAdapter\(\s*prismaFresh\s*,/);
    expect(code).not.toMatch(/prismaAdapter\(\s*prisma\s*,/);
  });

  it("the identity writers default to prismaFresh when the caller passes no transaction", () => {
    const code = stripComments(read(path.join(REPO_ROOT, "src/lib/auth/identity.ts")));
    expect(code).toMatch(/tx: IdentityDb = prismaFresh/);
    expect(code).toMatch(/prismaFresh\.\$transaction/);
  });

  it("the import scanner sees real imports and skips type-only ones (guards the I5/I8 scanners)", () => {
    const refs = importRefs(
      [
        'import "server-only";',
        'import { a } from "@/lib/prisma";',
        'import type { B } from "./b";',
        'export * from "./c";',
        'const d = await import("./d");',
      ].join("\n")
    );
    expect(refs).toEqual([
      { spec: "server-only", typeOnly: false },
      { spec: "@/lib/prisma", typeOnly: false },
      { spec: "./b", typeOnly: true },
      { spec: "./c", typeOnly: false },
      { spec: "./d", typeOnly: false },
    ]);
  });
});

describe("I5 fixtures — the scanner fails when the invariant is broken", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "i5-"));
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

  it("flags the cached client reading an Auth* model, even inside an owner module", () => {
    const root = tree({
      "src/lib/auth/auth-session.ts": 'import { prisma } from "@/lib/prisma";\nawait prisma.authSession.findFirst({});\n',
    });
    const rules = scanI5(root).map((v) => v.rule);
    expect(rules).toContain("cached prisma client used on an Auth* model");
    expect(rules.some((r) => r.includes("only prismaFresh allowed"))).toBe(true);
  });

  it("flags prismaFresh used on an Auth* model from a non-owner file", () => {
    const root = tree({
      "src/lib/actions/leak.ts": 'import { prismaFresh } from "@/lib/prisma";\nawait prismaFresh.authUser.findMany();\n',
    });
    expect(scanI5(root)).toEqual([
      expect.objectContaining({ file: "src/lib/actions/leak.ts", rule: "Auth* model delegate outside the owner modules" }),
    ]);
  });

  it("flags a transaction client reaching an Auth* model from a non-owner file", () => {
    const root = tree({ "src/lib/actions/tx.ts": "await tx.authAccount.updateMany({});\n" });
    expect(scanI5(root)).toHaveLength(1);
  });

  it("flags raw SQL against an Auth* table outside the owner modules", () => {
    const root = tree({ "src/lib/x.ts": 'await db.$queryRaw`select * from "AuthSession"`;\n' });
    expect(scanI5(root)[0]?.rule).toMatch(/raw SQL/);
  });

  it("does not flag prose in comments, nor an owner module using prismaFresh", () => {
    const root = tree({
      "src/lib/x.ts": "// never call prisma.authUser here\n/* prismaFresh.authSession */\nexport const ok = 1;\n",
      "src/lib/auth/identity.ts": 'import { prismaFresh } from "@/lib/prisma";\nawait prismaFresh.authUser.findMany();\n',
    });
    expect(scanI5(root)).toEqual([]);
  });
});
