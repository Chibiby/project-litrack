import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";
import { ADVISORY_MODE_LABELS } from "@/lib/constants/enum-labels";

/**
 * The migration names a designation literal and two enum values in SQL, where no
 * type checker reaches. Renaming any of them would leave the backfill silently
 * matching nothing — or, worse, releasing sections that hold learners. These
 * assertions pin the rule, the same way password-is-school-id-backfill.test.ts
 * pins its audit action names.
 */
const SQL = readFileSync(
  join(process.cwd(), "prisma/migrations/20260911000010_teacher_advisory_mode/migration.sql"),
  "utf8"
);
const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("teacher advisory mode migration", () => {
  it("creates the enum with exactly the three modes the app labels", () => {
    expect(code).toMatch(/CREATE TYPE "AdvisoryMode" AS ENUM \('DEFAULT', 'FLOATING', 'MULTI_GRADE'\)/);
    expect(Object.keys(ADVISORY_MODE_LABELS).sort()).toEqual(["DEFAULT", "FLOATING", "MULTI_GRADE"]);
  });

  it("adds the column NOT NULL with a DEFAULT, so every existing row lands on DEFAULT", () => {
    expect(code).toMatch(
      /ALTER TABLE "TeacherProfile" ADD COLUMN "advisoryMode" "AdvisoryMode" NOT NULL DEFAULT 'DEFAULT'/
    );
  });

  it("marks MULTI_GRADE only where two or more LIVE sections are held", () => {
    expect(code).toMatch(/SET "advisoryMode" = 'MULTI_GRADE'/);
    expect(code).toMatch(/"deletedAt" IS NULL\s*\)\s*>=\s*2/);
  });

  it("releases only volunteers' sections, and only sections with no live learner", () => {
    expect(code).toContain(`'${ARAL_VOLUNTEER_DESIGNATION}'`);
    expect(code).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM "Learner" l\s+WHERE l\."sectionId" = s\.id AND l\."deletedAt" IS NULL/);
  });

  it("never sets a teacher to FLOATING — floating is declared, not inferred", () => {
    expect(code).not.toMatch(/'FLOATING'\s*(WHERE|;)/);
    expect(code.match(/'FLOATING'/g)?.length).toBe(1); // only in CREATE TYPE
  });
});
