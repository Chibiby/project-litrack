import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  APP_VERSION,
  RELEASES,
  compareVersions,
  latestRelease,
} from "@/lib/releases";

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("1.0.9", "1.0.10")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("compares numerically, not as strings", () => {
    // "10" < "9" as strings. This is the bug the test exists to catch.
    expect(compareVersions("1.0.10", "1.0.9")).toBeGreaterThan(0);
  });
});

describe("RELEASES", () => {
  it("is not empty", () => {
    expect(RELEASES.length).toBeGreaterThan(0);
  });

  it("is strictly descending by version, newest first", () => {
    for (let i = 1; i < RELEASES.length; i++) {
      expect(
        compareVersions(RELEASES[i - 1].version, RELEASES[i].version)
      ).toBeGreaterThan(0);
    }
  });

  it("has no duplicate versions", () => {
    const seen = new Set(RELEASES.map((r) => r.version));
    expect(seen.size).toBe(RELEASES.length);
  });

  it("carries a YYYY-MM-DD date on every entry", () => {
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Rejects 2026-13-01 and 2026-02-30, which the regex alone accepts.
      expect(new Date(`${r.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(r.date);
    }
  });

  it("carries a semver version with no leading v on every entry", () => {
    for (const r of RELEASES) {
      expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("lists at least one fix per entry, none of them blank", () => {
    for (const r of RELEASES) {
      expect(r.fixes.length).toBeGreaterThan(0);
      for (const fix of r.fixes) expect(fix.trim().length).toBeGreaterThan(0);
    }
  });

  it("carries a non-blank title on every entry", () => {
    for (const r of RELEASES) {
      expect(r.title.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("APP_VERSION", () => {
  it("is the newest release", () => {
    expect(APP_VERSION).toBe(RELEASES[0].version);
    expect(latestRelease()).toBe(RELEASES[0]);
  });

  it("matches package.json, so the two can never drift", () => {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { version: string };
    expect(pkg.version).toBe(APP_VERSION);
  });
});
