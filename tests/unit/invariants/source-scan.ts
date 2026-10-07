import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Shared helpers for the repo-invariant tests (I5, I6, I8, I11 in
 * docs/better-auth-migration.md section 3). Nothing here runs application
 * code: the invariants are rules about source text and the import graph.
 *
 * Every helper takes the repo root as a parameter so a test can aim the same
 * scanner at a temporary tree holding a deliberate violation. That is how each
 * invariant proves it can fail (see the "fixture" blocks in the test files).
 */

export const REPO_ROOT = path.resolve(__dirname, "../../..");

const SKIP_DIRS = new Set(["node_modules", ".next", ".git", ".open-next", ".claude", "coverage"]);

/** Forward-slash path relative to `root`, the form the allow-lists are written in. */
export function rel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

/** Every file under `dir` whose name matches `ext`, as absolute paths. A missing dir is empty. */
export function walk(dir: string, ext: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(full, ext);
    return ext.test(entry.name) ? [full] : [];
  });
}

/** Every directory path under `dir` (relative to `root`, forward slashes). */
export function walkDirs(root: string, dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    return [rel(root, full), ...walkDirs(root, full)];
  });
}

export function read(file: string): string {
  return readFileSync(file, "utf8");
}

/**
 * Drops block comments and whole-line `//` comments, so prose that names a
 * forbidden identifier ("never `prisma.authUser`") is not scanned as code.
 * Line structure is preserved so reported positions stay meaningful.
 */
export function stripComments(source: string): string {
  const noBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return noBlocks
    .split(/\r?\n/)
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

export type ImportRef = { spec: string; typeOnly: boolean };

/**
 * Module specifiers a file loads at runtime or build time: static imports
 * (including side-effect imports such as `import "server-only"`), re-exports,
 * and `import("literal")`. `import type` / `export type` are flagged so the
 * caller can ignore them: TypeScript erases them, so they add nothing to a
 * bundle.
 */
export function importRefs(source: string): ImportRef[] {
  const code = stripComments(source);
  const out: ImportRef[] = [];
  for (const m of code.matchAll(/\bimport\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?["']([^"']+)["']/g)) {
    out.push({ spec: m[2], typeOnly: Boolean(m[1]) });
  }
  for (const m of code.matchAll(/\bexport\s+(type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s+from\s+["']([^"']+)["']/g)) {
    out.push({ spec: m[2], typeOnly: Boolean(m[1]) });
  }
  for (const m of code.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    out.push({ spec: m[1], typeOnly: false });
  }
  return out;
}

const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", ".mts", ".js", "/index.ts", "/index.tsx"];

/** Resolve `@/x` and relative specifiers to a file under `root`; null for packages or unresolved. */
export function resolveLocalImport(root: string, fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(root, "src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = base + suffix;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function isPackageSpec(spec: string): boolean {
  return !spec.startsWith(".") && !spec.startsWith("@/");
}

export type ImportClosure = {
  /** Local files reachable from the entry through runtime imports (entry included), relative to root. */
  files: string[];
  /** Package specifiers imported anywhere in that closure, each with the first file that imports it. */
  packages: Map<string, string>;
};

/** Transitive runtime-import closure of `entry`. Type-only imports are not followed. */
export function importClosure(root: string, entry: string): ImportClosure {
  const seen = new Set<string>();
  const packages = new Map<string, string>();
  const stack = [entry];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const ref of importRefs(read(file))) {
      if (ref.typeOnly) continue;
      if (isPackageSpec(ref.spec)) {
        if (!packages.has(ref.spec)) packages.set(ref.spec, rel(root, file));
        continue;
      }
      const resolved = resolveLocalImport(root, file, ref.spec);
      if (resolved) stack.push(resolved);
    }
  }
  return { files: [...seen].map((f) => rel(root, f)).sort(), packages };
}
