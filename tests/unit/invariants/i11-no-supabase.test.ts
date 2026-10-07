import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT, read, rel, walk } from "./source-scan";

/**
 * I11: no Supabase package scope anywhere.
 *
 * Mirrors the removal lane's grep gate: the package scope and the app's own
 * Supabase module path must not appear in src, scripts, prisma, tests or
 * e2e, and the dependency must be gone from package.json. Comments count, as
 * they do for grep. Until the removal lane lands this reports every remaining
 * reference, which is the intended failure: it is the list of what is left.
 *
 * The needles are built from fragments so this file does not match itself.
 */

const PACKAGE_SCOPE = "@" + "supabase/";
const MODULE_PATH = "lib/" + "supabase";
const SCANNED_DIRS = ["src", "scripts", "prisma", "tests", "e2e"];
const SCANNED_FILES = /\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx|json|sql|md)$/;

export type Hit = { file: string; line: number; needle: string };

export function scanI11(root: string): Hit[] {
  const hits: Hit[] = [];
  for (const dir of SCANNED_DIRS) {
    for (const abs of walk(path.join(root, dir), SCANNED_FILES)) {
      const lines = read(abs).split(/\r?\n/);
      lines.forEach((text, i) => {
        for (const needle of [PACKAGE_SCOPE, MODULE_PATH]) {
          if (text.includes(needle)) hits.push({ file: rel(root, abs), line: i + 1, needle });
        }
      });
    }
  }
  return hits;
}

/** Dependency names in package.json that live under the removed scope. */
export function scopedDependencies(root: string): string[] {
  const pkg = JSON.parse(read(path.join(root, "package.json"))) as Record<string, Record<string, string> | undefined>;
  return ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies", "overrides"].flatMap((section) =>
    Object.keys(pkg[section] ?? {}).filter((name) => (name + "/").startsWith(PACKAGE_SCOPE))
  );
}

function summarize(hits: Hit[]): string[] {
  const byFile = new Map<string, number>();
  for (const h of hits) byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
  return [...byFile].map(([file, n]) => `${file} (${n})`).sort();
}

describe("I11 — no Supabase package scope anywhere", () => {
  it("scans a substantial tree (guards against a scan that matches nothing)", () => {
    expect(walk(path.join(REPO_ROOT, "src"), SCANNED_FILES).length).toBeGreaterThan(300);
    expect(walk(path.join(REPO_ROOT, "tests"), SCANNED_FILES).length).toBeGreaterThan(100);
  });

  it("no source, script, prisma, test or e2e file names the package scope or the app's supabase module", () => {
    expect(summarize(scanI11(REPO_ROOT))).toEqual([]);
  });

  it("package.json declares no dependency under the removed scope", () => {
    expect(scopedDependencies(REPO_ROOT)).toEqual([]);
  });

  it("the old module directory is gone", () => {
    expect(walk(path.join(REPO_ROOT, "src", MODULE_PATH.split("/")[0], MODULE_PATH.split("/")[1]), /./)).toEqual([]);
  });
});

describe("I11 fixtures — the scanner fails when the invariant is broken", () => {
  const tmp = mkdtempSync(path.join(tmpdir(), "i11-"));
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

  it("flags an import of the package scope in src, scripts, prisma, tests and e2e", () => {
    for (const dir of SCANNED_DIRS) {
      const root = tree({ [`${dir}/a.ts`]: `import { x } from "${PACKAGE_SCOPE}ssr";\n` });
      expect(scanI11(root), dir).toEqual([{ file: `${dir}/a.ts`, line: 1, needle: PACKAGE_SCOPE }]);
    }
  });

  it("flags a mock of the app's supabase module, and a mention in a comment", () => {
    const root = tree({
      "tests/unit/a.test.ts": `vi.mock("@/${MODULE_PATH}/server", () => ({}));\n`,
      "src/b.ts": `// was ${PACKAGE_SCOPE}ssr\n`,
    });
    expect(summarize(scanI11(root))).toEqual(["src/b.ts (1)", "tests/unit/a.test.ts (1)"]);
  });

  it("flags a scoped dependency in package.json", () => {
    const root = tree({
      "package.json": JSON.stringify({ dependencies: { [PACKAGE_SCOPE + "ssr"]: "^1.0.0", zod: "^3.0.0" } }),
    });
    expect(scopedDependencies(root)).toEqual([PACKAGE_SCOPE + "ssr"]);
  });

  it("is quiet on a clean tree", () => {
    const root = tree({ "src/a.ts": "export const a = 1;\n", "package.json": "{}" });
    expect(scanI11(root)).toEqual([]);
    expect(scopedDependencies(root)).toEqual([]);
  });
});
