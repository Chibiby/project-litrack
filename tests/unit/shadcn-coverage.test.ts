import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../../src");

/**
 * `src/components/ui` holds the primitives themselves, and the printable
 * report is a deliberate plain-HTML document for the browser print pipeline —
 * shadcn wrappers there would fight the print stylesheet.
 */
const EXEMPT = [
  "components/ui/",
  "components/reports/printable-learners-report.tsx",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("shadcn coverage", () => {
  it("uses ui primitives instead of raw table and button elements", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (EXEMPT.some((e) => rel.startsWith(e) || rel === e)) continue;
      const text = readFileSync(file, "utf8");
      text.split("\n").forEach((line, i) => {
        if (/<table[\s>]/.test(line) || /<button[\s>]/.test(line)) {
          offenders.push(`${rel}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
