import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `20260929000001_aral_mosy_decision` carries two SQL-only CHECKs Prisma cannot
 * express, so a regenerated migration would silently drop them. Pinned here.
 */
const SQL = readFileSync(
  join(process.cwd(), "prisma/migrations/20260929000001_aral_mosy_decision/migration.sql"),
  "utf8"
);
const code = SQL.split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("aral mosy decision migration", () => {
  it("keeps the reason-iff-MOVE_OUT CHECK in its COALESCE form", () => {
    expect(code).toMatch(/CONSTRAINT "AralMosyDecision_reason_iff_move_out"/);
    expect(code).toContain(
      `CHECK ((COALESCE("decision"::text, '') = 'MOVE_OUT') = ("reason" IS NOT NULL))`
    );
  });

  it("keeps the 250-char remarks CHECK", () => {
    expect(code).toMatch(/CONSTRAINT "AralMosyDecision_remarks_length"/);
    expect(code).toContain(`CHECK ("remarks" IS NULL OR char_length("remarks") <= 250)`);
  });

  it("keeps the unique key the action upserts on", () => {
    expect(code).toMatch(
      /CREATE UNIQUE INDEX "AralMosyDecision_learnerId_schoolYearId_key"\s+ON "AralMosyDecision"\("learnerId", "schoolYearId"\)/
    );
  });

  it("enables RLS on the new table", () => {
    expect(code).toContain(`ALTER TABLE "AralMosyDecision" ENABLE ROW LEVEL SECURITY;`);
  });

  it("is additive: no DROP, TRUNCATE, DELETE, UPDATE or ALTER TYPE in executable SQL", () => {
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    expect(code).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(code).not.toMatch(/\bUPDATE\s+"/i);
    expect(code).not.toMatch(/ALTER\s+TYPE/i);
  });

  it("alters no table other than AralMosyDecision", () => {
    const tables = [...code.matchAll(/ALTER TABLE\s+("[^"]+")/g)].map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    expect(new Set(tables)).toEqual(new Set(['"AralMosyDecision"']));
  });
});
