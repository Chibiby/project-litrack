import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../../src");

/**
 * Next enforces, at runtime and only at runtime, that a `"use server"` module
 * exports nothing but async functions. `tsc` and `next build` both accept a
 * stray `export const FOO = {...}` in such a file; the failure only appears
 * when a route's action chunk actually loads the module:
 *
 *   A "use server" file can only export async functions, found object.
 *
 * and it names neither the file nor the export. This test is the static gate
 * that stands in for that missing compile-time check.
 *
 * `export type` / `export interface` are exempt — they're erased before
 * runtime and never cross the server-action boundary.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/**
 * True only when the file's first real statement — after skipping leading
 * whitespace and comments (`//...` and `/*...*\/`), and before any import or
 * other statement — is the literal directive `"use server"` / `'use server'`.
 *
 * A file that merely *mentions* "use server" inside a comment (several genuine
 * cases exist in this tree, describing why a module is deliberately plain)
 * must not match: once the leading comment is stripped, the next real token
 * is an `import` or `export`, not the directive string.
 */
function hasUseServerDirective(text: string): boolean {
  let i = 0;
  const n = text.length;
  for (;;) {
    while (i < n && /\s/.test(text[i])) i++;
    if (text.startsWith("//", i)) {
      const end = text.indexOf("\n", i);
      i = end === -1 ? n : end + 1;
      continue;
    }
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    break;
  }
  return text.startsWith('"use server"', i) || text.startsWith("'use server'", i);
}

type Offense = { line: number; message: string };

const OK_VALUE = 0;
const FLAG_VALUE = 1;

/** Classify the right-hand side of `export const NAME = <rhs>` (or `export default <rhs>`). */
function classifyRhs(rhs: string): typeof OK_VALUE | typeof FLAG_VALUE {
  const s = rhs.trim();
  if (/^async\b/.test(s)) return OK_VALUE; // async function expr / async arrow
  // A call expression, e.g. `action(...)`: the house pattern wraps a handler
  // and returns an async function at runtime. We can't verify the callee's
  // return type statically, but this is the one call-shaped form the codebase
  // uses in "use server" modules, so treat any bare call as presumed OK.
  if (/^[A-Za-z_$][\w$]*\s*\(/.test(s)) return OK_VALUE;
  return FLAG_VALUE;
}

function scanFile(rel: string, text: string): Offense[] {
  const offenses: Offense[] = [];
  const lines = text.split(/\r?\n/);

  for (let idx = 0; idx < lines.length; idx++) {
    const raw = lines[idx];
    const line = raw.trimStart();
    const lineNo = idx + 1;
    if (!line.startsWith("export")) continue;

    // Turbopack 15.5 can retain a type-only re-export from a server-action
    // module and evaluate the missing binding at runtime. Local declarations
    // remain erased, but re-exported types belong in a plain shared module.
    if (/^export\s+type\s*\{/.test(line)) {
      offenses.push({
        line: lineNo,
        message: `type re-export "${line.trim()}" is unsafe in a Turbopack server-action module; import the type from its plain defining module instead.`,
      });
      continue;
    }
    // Local type declarations are erased before runtime.
    if (/^export\s+(type|interface)\b/.test(line)) continue;

    // Re-export forms put a runtime binding on the module's surface, and we
    // cannot tell statically whether the re-exported binding is an async
    // function or some other value. Flag the form itself. (Current tree has
    // zero of these in "use server" files, so this produces no false
    // positives — verified by full-tree scan.)
    if (/^export\s*\*/.test(line)) {
      offenses.push({
        line: lineNo,
        message:
          `re-export "${line.trim()}" cannot be verified as an async function statically; ` +
          `move the value to a plain module and import it from both sides.`,
      });
      continue;
    }
    if (/^export\s*\{/.test(line)) {
      offenses.push({
        line: lineNo,
        message:
          `re-export "${line.trim()}" cannot be verified as an async function statically; ` +
          `move the value to a plain module and import it from both sides.`,
      });
      continue;
    }

    if (/^export\s+async\s+function\b/.test(line)) continue; // OK

    if (/^export\s+function\b/.test(line)) {
      const m = line.match(/^export\s+function\s+([A-Za-z0-9_$]+)/);
      offenses.push({
        line: lineNo,
        message:
          `export "${m?.[1] ?? "?"}" is a non-async function; ` +
          `move the value to a plain module and import it from both sides.`,
      });
      continue;
    }

    if (/^export\s+class\b/.test(line)) {
      const m = line.match(/^export\s+class\s+([A-Za-z0-9_$]+)/);
      offenses.push({
        line: lineNo,
        message:
          `export "${m?.[1] ?? "?"}" is a class; ` +
          `move the value to a plain module and import it from both sides.`,
      });
      continue;
    }

    if (/^export\s+enum\b/.test(line)) {
      const m = line.match(/^export\s+enum\s+([A-Za-z0-9_$]+)/);
      offenses.push({
        line: lineNo,
        message:
          `export "${m?.[1] ?? "?"}" is an enum; ` +
          `move the value to a plain module and import it from both sides.`,
      });
      continue;
    }

    if (/^export\s+(let|var)\b/.test(line)) {
      const m = line.match(/^export\s+(?:let|var)\s+([A-Za-z0-9_$]+)/);
      offenses.push({
        line: lineNo,
        message:
          `export "${m?.[1] ?? "?"}" is a mutable ${line.startsWith("export let") ? "let" : "var"} binding; ` +
          `move the value to a plain module and import it from both sides.`,
      });
      continue;
    }

    if (/^export\s+default\b/.test(line)) {
      const rhs = line.replace(/^export\s+default\s*/, "");
      if (classifyRhs(rhs) === FLAG_VALUE && !/^async\s+function\b/.test(rhs)) {
        offenses.push({
          line: lineNo,
          message:
            `default export is not an async function; ` +
            `move the value to a plain module and import it from both sides.`,
        });
      }
      continue;
    }

    if (/^export\s+const\b/.test(line)) {
      const nameMatch = line.match(/^export\s+const\s+([A-Za-z0-9_$]+)/);
      const name = nameMatch?.[1] ?? "(destructured export)";
      const eqIdx = line.indexOf("=");
      if (eqIdx === -1) {
        // `export const x: SomeType;` (ambient) — nothing to classify; skip.
        continue;
      }
      const rhs = line.slice(eqIdx + 1);
      if (classifyRhs(rhs) === FLAG_VALUE) {
        offenses.push({
          line: lineNo,
          message:
            `export "${name}" is not an async function (value: \`${rhs.trim().slice(0, 40)}\`); ` +
            `move the value to a plain module and import it from both sides.`,
        });
      }
      continue;
    }
  }

  return offenses;
}

describe("\"use server\" export surface", () => {
  it("exports only async functions from every \"use server\" module", () => {
    const violations: string[] = [];

    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      if (!hasUseServerDirective(text)) continue;

      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      const offenses = scanFile(rel, text);
      for (const o of offenses) {
        violations.push(`src/${rel}:${o.line} — ${o.message}`);
      }
    }

    expect(violations).toEqual([]);
  });
});
