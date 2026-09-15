import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_TERM_SUBJECTS } from "@/lib/terms/subjects";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

/**
 * `20260915000002_term_subject_defaults` seeds its subject names and
 * positions as SQL string literals, where no type checker reaches. Pinning
 * them here catches a rename or reorder of `DEFAULT_TERM_SUBJECTS`
 * (src/lib/terms/subjects.ts) that the migration's own literals would
 * silently drift from — the same reasoning
 * `teacher-advisory-mode-migration.test.ts` applies to its enum literals.
 */
const SQL = readFileSync(
  join(process.cwd(), "prisma/migrations/20260915000002_term_subject_defaults/migration.sql"),
  "utf8"
);
const code = SQL.split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

/** Every GradeLevelType value except FLOATING — this migration's seed scope. */
const NON_FLOATING_GRADE_TYPES = Object.keys(GRADE_LEVEL_LABELS).filter(
  (type) => type !== "FLOATING"
);

describe("term subject defaults migration", () => {
  it("creates the table with the schema-declared columns", () => {
    expect(code).toMatch(/CREATE TABLE "TermSubjectDefault"/);
    expect(code).toMatch(/"gradeLevelType"\s+"GradeLevelType" NOT NULL/);
    expect(code).toMatch(/"name"\s+TEXT NOT NULL/);
    expect(code).toMatch(/"position"\s+INTEGER NOT NULL/);
  });

  it("keeps the SQL-only partial unique on (gradeLevelType, lower(btrim(name))) WHERE deletedAt IS NULL", () => {
    expect(code).toMatch(
      /CREATE UNIQUE INDEX "TermSubjectDefault_type_active_name_unique" ON "TermSubjectDefault"\("gradeLevelType", lower\(btrim\("name"\)\)\) WHERE "deletedAt" IS NULL;/
    );
  });

  it("seeds every non-FLOATING GradeLevelType value", () => {
    for (const type of NON_FLOATING_GRADE_TYPES) {
      expect(code, `missing seed row for ${type}`).toContain(`('${type}')`);
    }
    // And explicitly never seeds FLOATING.
    expect(code).not.toMatch(/\('FLOATING'\)/);
  });

  it("seeds names and positions byte-identical to DEFAULT_TERM_SUBJECTS", () => {
    expect(DEFAULT_TERM_SUBJECTS).toHaveLength(8);
    for (const { name, position } of DEFAULT_TERM_SUBJECTS) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(code, `missing seed row for "${name}" at position ${position}`).toMatch(
        new RegExp(`\\('${escaped}',\\s*${position}\\)`)
      );
    }
  });

  it("compares on lower(btrim(...)) against non-archived rows only, matching the partial unique", () => {
    expect(code).toMatch(/lower\(btrim\(existing\."name"\)\)\s*=\s*lower\(btrim\(d\.name\)\)/);
    expect(code).toMatch(/existing\."deletedAt" IS NULL/);
  });
});
