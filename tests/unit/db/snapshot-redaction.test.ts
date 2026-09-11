import { describe, expect, it } from "vitest";
import {
  REDACTED_SNAPSHOT_COLUMNS,
  redactSnapshotRows,
  SNAPSHOT_MODELS,
} from "@/lib/db/schema-order";

/**
 * A backup is a file people download. The sealed School Head passwords the
 * accounts console reveals must not travel in it. And because restore never
 * touches Supabase Auth, a restored seal would reveal a password that stopped
 * working after the backup was taken.
 */

describe("snapshot redaction", () => {
  it("nulls the sealed password columns on User rows", () => {
    const rows = [
      {
        id: "head-1",
        role: "SCHOOL_HEAD",
        passwordIsSchoolId: false,
        passwordVaultCipher: "v1.iv.tag.ct",
        passwordVaultSetAt: new Date("2026-09-11T04:00:00.000Z"),
      },
    ];

    const [redacted] = redactSnapshotRows("User", rows);

    expect(redacted.passwordVaultCipher).toBeNull();
    expect(redacted.passwordVaultSetAt).toBeNull();
    // Everything else survives, including the flag restore still needs.
    expect(redacted.id).toBe("head-1");
    expect(redacted.passwordIsSchoolId).toBe(false);
  });

  it("does not mutate the rows it was given", () => {
    const rows = [{ id: "head-1", passwordVaultCipher: "v1.iv.tag.ct", passwordVaultSetAt: null }];
    redactSnapshotRows("User", rows);
    expect(rows[0].passwordVaultCipher).toBe("v1.iv.tag.ct");
  });

  it("leaves other models untouched, by reference", () => {
    const rows = [{ id: "school-1", passwordVaultCipher: "not a real column here" }];
    expect(redactSnapshotRows("School", rows)).toBe(rows);
  });

  it("does not invent columns a row never had", () => {
    const [redacted] = redactSnapshotRows("User", [{ id: "u1" }]);
    expect(redacted).toEqual({ id: "u1" });
  });

  it("only names models that are actually backed up", () => {
    // A redaction keyed on a typo would silently redact nothing.
    const backedUp = new Set(SNAPSHOT_MODELS.map((m) => m.model));
    for (const model of Object.keys(REDACTED_SNAPSHOT_COLUMNS)) {
      expect(backedUp.has(model as never)).toBe(true);
    }
  });
});
