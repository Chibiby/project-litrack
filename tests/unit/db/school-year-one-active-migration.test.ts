import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `20261003000003_school_year_one_active` adds a partial unique index Prisma
 * cannot express, so a regenerated migration would silently drop it. Pinned.
 */
const SQL = readFileSync(
  join(process.cwd(), "prisma/migrations/20261003000003_school_year_one_active/migration.sql"),
  "utf8"
);
const code = SQL.split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("school year one-active migration", () => {
  it("creates the partial unique index on schoolId where isActive", () => {
    expect(code).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS "SchoolYear_school_active_unique"\s+ON "SchoolYear"\("schoolId"\)\s+WHERE "isActive"/
    );
  });

  it("documents the pre-flight duplicate check", () => {
    expect(SQL).toMatch(/HAVING count\(\*\) > 1/);
  });

  it("is additive: no DROP, TRUNCATE, DELETE, UPDATE or ALTER in executable SQL", () => {
    expect(code).not.toMatch(/\b(DROP|TRUNCATE|DELETE|UPDATE|ALTER)\b/i);
  });
});
