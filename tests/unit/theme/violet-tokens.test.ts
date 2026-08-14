import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
const tw = readFileSync(resolve(process.cwd(), "tailwind.config.ts"), "utf8");

function block(name: ":root" | ".dark"): string {
  const start = css.indexOf(`${name} {`);
  expect(start, `${name} block missing`).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("\n  }", start));
}

describe("violet accent tokens", () => {
  const VARS = [
    "--violet",
    "--violet-foreground",
    "--violet-soft",
    "--violet-soft-foreground",
  ];

  it("defines every violet var in both themes", () => {
    for (const name of VARS) {
      expect(block(":root")).toContain(`${name}:`);
      expect(block(".dark")).toContain(`${name}:`);
    }
  });

  it("uses the mock's blue-leaning hue 255, not the old 262", () => {
    expect(block(":root")).toMatch(/--violet:\s*255 /);
    expect(tw).not.toMatch(/hsl\(262 /);
  });

  it("wires the vars into the Tailwind violet color", () => {
    expect(tw).toContain('DEFAULT: "hsl(var(--violet))"');
    expect(tw).toContain('soft: "hsl(var(--violet-soft))"');
    expect(tw).toContain('"soft-foreground": "hsl(var(--violet-soft-foreground))"');
  });

  it("keeps the numbered scale so existing ARAL utilities still resolve", () => {
    for (const step of [50, 100, 200, 500, 600, 700, 800, 900, 950]) {
      expect(tw).toContain(`${step}: "hsl(255 `);
    }
  });
});
