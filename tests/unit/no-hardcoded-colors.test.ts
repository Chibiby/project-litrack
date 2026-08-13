import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../../src");

/** Literal colors that break dark mode when written into a .tsx file. */
const BANNED = /\b(?:bg-white|bg-slate-\d{2,3}|bg-gray-\d{2,3}|text-gray-\d{2,3}|border-gray-\d{2,3})\b/;

/**
 * Deliberate exceptions (spec R2): the violet ARAL accent and the amber
 * super-admin impersonation chips are design decisions, not palette drift.
 * Neither uses a banned class, so this list stays empty — it exists so a
 * future exception must be argued for explicitly here.
 */
const ALLOWED_FILES = new Set<string>([]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("palette discipline", () => {
  it("has no hardcoded colors in .tsx files", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (ALLOWED_FILES.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (BANNED.test(line)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
