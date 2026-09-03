import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Every Prisma model must appear in `prisma/rls-policies.sql`'s enable list.
 *
 * RLS is the deny-all layer between a public-schema table and PostgREST. It only
 * bites when a role also holds SELECT on that table, so a missing enable line is
 * not automatically an open door — as of 2026-09-03 only `User` carries an `anon`
 * grant in this project, and RLS is precisely what makes that grant return
 * nothing. But the two halves are set by different tools in different places, and
 * a table with RLS off is one stray grant away from being readable. Enabling it
 * costs nothing and removes the coupling.
 *
 * The failure mode is invisible from inside the app: no query fails, no page
 * breaks, and the diff that introduces it looks like an ordinary new model. It
 * had already happened three times (`Report`, `SupportTicket`, `UnlockGrant`)
 * before this test existed, which is what a repo-invariant test is for.
 */

const PRISMA = path.resolve(__dirname, "../../prisma");

function readModels(): string[] {
  const schema = readFileSync(path.join(PRISMA, "schema.prisma"), "utf8");
  return [...schema.matchAll(/^model\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/gm)].map(
    (m) => m[1]
  );
}

function readRlsEnabledTables(): Set<string> {
  const sql = readFileSync(path.join(PRISMA, "rls-policies.sql"), "utf8");
  // Comments in that file name tables too, so match only real statements.
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return new Set(
    [
      ...stripped.matchAll(
        /ALTER\s+TABLE\s+"([A-Za-z0-9_]+)"\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi
      ),
    ].map((m) => m[1])
  );
}

describe("RLS coverage", () => {
  it("enables row level security on every model in the schema", () => {
    const enabled = readRlsEnabledTables();
    const missing = readModels().filter((model) => !enabled.has(model));

    expect(
      missing,
      `These models have no ENABLE ROW LEVEL SECURITY line in prisma/rls-policies.sql, ` +
        `so nothing but the absence of a SELECT grant keeps them out of PostgREST: ` +
        `${missing.join(", ")}`
    ).toEqual([]);
  });

  it("covers the implicit join table Prisma creates for TeacherGrades", () => {
    // Not a `model`, so the check above never reaches it, but it holds real
    // teacher-to-grade assignments and Supabase grants anon on it like any other
    // public-schema table.
    expect(readRlsEnabledTables().has("_TeacherGrades")).toBe(true);
  });

  it("names no table that the schema does not define", () => {
    // A stale entry is not a security hole, but it means the file and the schema
    // have drifted — usually a renamed model whose old name was left behind, and
    // whose new name is therefore missing.
    const models = new Set([...readModels(), "_TeacherGrades"]);
    const stale = [...readRlsEnabledTables()].filter((t) => !models.has(t));
    expect(stale).toEqual([]);
  });
});
