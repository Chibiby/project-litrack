import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_ACTIONS } from "@/lib/audit";

/**
 * `20260910000004_backfill_password_is_school_id` decides whether a School
 * Head's password is still their School ID by replaying audit rows, and it names
 * three audit actions as string literals in SQL. Renaming one of those constants
 * would not break a build, a type, or any test — the migration would simply stop
 * seeing those events and start reporting that heads with regenerated
 * credentials can have their School ID read out of the console. That is the same
 * class of silent failure `schema-order.test.ts` guards against, and the reason
 * this file exists.
 *
 * The migration is already applied wherever it ran, so this is not protecting
 * the historical backfill. It protects the *rule*, which is the thing anyone
 * will copy the next time this question comes up.
 */

const MIGRATION = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260910000004_backfill_password_is_school_id/migration.sql"
  ),
  "utf8"
);

/**
 * The audit actions that mark a School Head credential as no longer readable,
 * and the one that marks it readable again.
 */
const CREDENTIAL_EVENTS = [
  AUDIT_ACTIONS.PASSWORD_CHANGE,
  AUDIT_ACTIONS.SCHOOL_HEAD_CREDENTIAL_REGENERATED,
  AUDIT_ACTIONS.SCHOOL_HEAD_PASSWORD_RESET_DEFAULT,
] as const;

describe("passwordIsSchoolId backfill migration", () => {
  it("references every credential-affecting audit action by its current name", () => {
    for (const action of CREDENTIAL_EVENTS) {
      expect(
        MIGRATION.includes(`'${action}'`),
        `migration does not mention ${action}; renaming an audit action silently changes who the console shows a password for`
      ).toBe(true);
    }
  });

  it("excludes the skip reason rather than ranking it", () => {
    // A head who dismissed the first-login prompt AFTER choosing their own
    // password still has that custom password. If the skip were treated as the
    // latest password write it would displace the real change, and the console
    // would offer the School ID for an account it does not open. Four live
    // accounts were in exactly that state when this was written.
    expect(MIGRATION).toMatch(/set_password_skipped/);
    expect(MIGRATION).toMatch(/<>\s*'set_password_skipped'/);
  });

  it("only ever sets the flag true", () => {
    // Re-running must not revoke a credential the console is already showing,
    // and the migration must never claim a custom password is a School ID.
    const assignments = MIGRATION.match(/"passwordIsSchoolId"\s*=\s*\w+/g) ?? [];
    expect(assignments.length).toBeGreaterThan(0);
    const sets = assignments.filter((a) => /=\s*true/.test(a));
    expect(sets.length).toBe(1);
    expect(MIGRATION).toMatch(/"passwordIsSchoolId"\s*=\s*false/); // the guard, not an assignment
    expect(MIGRATION).not.toMatch(/SET\s+"passwordIsSchoolId"\s*=\s*false/i);
  });

  it("stays scoped to live School Heads", () => {
    expect(MIGRATION).toMatch(/"role"\s*=\s*'SCHOOL_HEAD'/);
    expect(MIGRATION).toMatch(/"deletedAt"\s+IS\s+NULL/i);
  });

  it("correlates admin-written rows on resourceId as well as userId", () => {
    // `regenerateSchoolHeadCredential` and `resetSchoolHeadPassword` record
    // userId = the acting admin and resourceId = the head. Matching only userId
    // would miss every admin-initiated credential event.
    expect(MIGRATION).toMatch(/COALESCE\(\s*a\."resourceId"\s*,\s*a\."userId"\s*\)/);
  });
});
