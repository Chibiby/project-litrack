import { describe, expect, it, vi } from "vitest";
import {
  chunk,
  planAuthBackfill,
  type ExistingAuthUser,
  type SourceAuthUser,
  type TargetUser,
} from "@/lib/auth/backfill-plan";

/**
 * `planAuthBackfill` (docs/better-auth-migration.md section 4). Pure: fixtures
 * in, plan out. Every assertion depends on the fixture it was given.
 */

const HASH_A = "$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234";
const HASH_B = "$2b$12$zyxwvutsrqponmlkjihgfeZYXWVUTSRQPONMLKJIHGFEDCBA98765";

const T0 = new Date("2026-01-01T00:00:00Z");
const T1 = new Date("2026-02-01T00:00:00Z");
const T2 = new Date("2026-03-01T00:00:00Z");

function src(id: string, overrides: Partial<SourceAuthUser> = {}): SourceAuthUser {
  return {
    id,
    email: `${id}@school.test`,
    passwordHash: HASH_A,
    emailConfirmed: true,
    createdAt: T0,
    updatedAt: T1,
    ...overrides,
  };
}

function user(authId: string, overrides: Partial<TargetUser> = {}): TargetUser {
  return {
    authId,
    email: `${authId}@school.test`,
    role: "TEACHER",
    deletedAt: null,
    ...overrides,
  };
}

describe("planAuthBackfill — create", () => {
  it("creates an identity for a live User with a matching auth row, carrying the hash verbatim", () => {
    const plan = planAuthBackfill([src("a1", { passwordHash: HASH_B })], [user("a1", { role: "SCHOOL_HEAD" })]);

    expect(plan.writes).toHaveLength(1);
    const [write] = plan.writes;
    expect(write.kind).toBe("create");
    expect(write.user).toMatchObject({
      id: "a1",
      email: "a1@school.test",
      role: "SCHOOL_HEAD",
      name: "",
      banned: false,
      emailVerified: true,
      createdAt: T0,
      updatedAt: T1,
    });
    expect(write.account).toMatchObject({
      id: "a1",
      accountId: "a1",
      userId: "a1",
      providerId: "credential",
      password: HASH_B,
    });
    expect(plan.counts).toMatchObject({ source: 1, targetUsers: 1, create: 1, update: 0, unchanged: 0 });
  });

  it("uses User.email and User.role, lowercased, not the Supabase email; reports a mismatch", () => {
    const plan = planAuthBackfill(
      [src("a1", { email: "old@elsewhere.test" })],
      [user("a1", { email: "  New.Name@School.test ", role: "TEACHER" })]
    );

    expect(plan.writes[0].user.email).toBe("new.name@school.test");
    expect(plan.emailMismatchIds).toEqual(["a1"]);
    expect(plan.counts.emailMismatches).toBe(1);
  });

  it("does not report a mismatch when the emails differ only by case or whitespace, or the source email is null", () => {
    const plan = planAuthBackfill(
      [src("a1", { email: "A1@SCHOOL.TEST" }), src("a2", { email: null })],
      [user("a1"), user("a2")]
    );
    expect(plan.emailMismatchIds).toEqual([]);
    expect(plan.counts.create).toBe(2);
  });

  it("carries emailConfirmed into emailVerified", () => {
    const plan = planAuthBackfill([src("a1", { emailConfirmed: false })], [user("a1")]);
    expect(plan.writes[0].user.emailVerified).toBe(false);
  });

  it("backfills a soft-deleted User that still has an auth row, and counts it", () => {
    const plan = planAuthBackfill([src("a1")], [user("a1", { deletedAt: T2 })]);
    expect(plan.counts).toMatchObject({ create: 1, deletedWithAuth: 1, liveWithoutAuth: 0 });
    expect(plan.writes).toHaveLength(1);
  });
});

describe("planAuthBackfill — orphans and missing auth rows", () => {
  it("lists an auth row with no User as an orphan and does not create it", () => {
    const plan = planAuthBackfill([src("a1"), src("ghost")], [user("a1")]);

    expect(plan.orphanIds).toEqual(["ghost"]);
    expect(plan.counts.orphans).toBe(1);
    expect(plan.writes.map((w) => w.user.id)).toEqual(["a1"]);
  });

  it("reports a live User with no auth row, and does not write for it", () => {
    const plan = planAuthBackfill([src("a1")], [user("a1"), user("lonely")]);

    expect(plan.liveWithoutAuthIds).toEqual(["lonely"]);
    expect(plan.counts.liveWithoutAuth).toBe(1);
    expect(plan.writes.map((w) => w.user.id)).toEqual(["a1"]);
  });

  it("counts a soft-deleted User with no auth row separately, not as live-without-auth", () => {
    const plan = planAuthBackfill([], [user("gone", { deletedAt: T2 })]);
    expect(plan.counts).toMatchObject({ deletedWithoutAuth: 1, liveWithoutAuth: 0 });
    expect(plan.liveWithoutAuthIds).toEqual([]);
    expect(plan.writes).toEqual([]);
  });

  it("an empty input plans nothing", () => {
    const plan = planAuthBackfill([], []);
    expect(plan.writes).toEqual([]);
    expect(plan.counts).toMatchObject({ source: 0, targetUsers: 0, create: 0, orphans: 0 });
  });
});

describe("planAuthBackfill — idempotence and newer-wins", () => {
  const sources = [src("a1"), src("a2", { updatedAt: T2 })];
  const users = [user("a1"), user("a2")];

  it("a re-run against already-backfilled identities makes zero changes", () => {
    const first = planAuthBackfill(sources, users);
    expect(first.writes).toHaveLength(2);

    const existing: ExistingAuthUser[] = first.writes.map((w) => ({ id: w.user.id, updatedAt: w.user.updatedAt }));
    const second = planAuthBackfill(sources, users, existing);

    expect(second.writes).toEqual([]);
    expect(second.counts).toMatchObject({ create: 0, update: 0, unchanged: 2 });
  });

  it("updates only the identity whose source is newer than the stored one", () => {
    const plan = planAuthBackfill(sources, users, [
      { id: "a1", updatedAt: T1 }, // equal: left alone
      { id: "a2", updatedAt: T1 }, // older than source T2: updated
    ]);

    expect(plan.writes.map((w) => [w.user.id, w.kind])).toEqual([["a2", "update"]]);
    expect(plan.counts).toMatchObject({ create: 0, update: 1, unchanged: 1 });
  });

  it("leaves an identity alone when the stored one is newer than the source", () => {
    const plan = planAuthBackfill([src("a1")], [user("a1")], [{ id: "a1", updatedAt: T2 }]);
    expect(plan.writes).toEqual([]);
    expect(plan.counts.unchanged).toBe(1);
  });

  it("creates when other identities exist but this one does not", () => {
    const plan = planAuthBackfill([src("a1")], [user("a1")], [{ id: "other", updatedAt: T2 }]);
    expect(plan.writes.map((w) => w.kind)).toEqual(["create"]);
  });
});

describe("planAuthBackfill — unusable rows", () => {
  it("skips a non-bcrypt hash and reports its authId", () => {
    const plan = planAuthBackfill(
      [src("a1", { passwordHash: "plain-text-ish" }), src("a2", { passwordHash: "$argon2id$v=19$m=65536" })],
      [user("a1"), user("a2")]
    );
    expect(plan.writes).toEqual([]);
    expect(plan.nonBcryptIds).toEqual(["a1", "a2"]);
    expect(plan.counts.nonBcrypt).toBe(2);
  });

  it("accepts the $2a$, $2b$ and $2y$ prefixes", () => {
    const hashes = ["$2a$10$x", "$2b$10$x", "$2y$10$x"];
    const plan = planAuthBackfill(
      hashes.map((h, i) => src(`u${i}`, { passwordHash: h })),
      hashes.map((_, i) => user(`u${i}`))
    );
    expect(plan.writes.map((w) => w.account.password)).toEqual(hashes);
  });

  it("flags two planned identities that would share an email", () => {
    const plan = planAuthBackfill(
      [src("a1"), src("a2")],
      [user("a1", { email: "same@school.test" }), user("a2", { email: "SAME@school.test" })]
    );
    expect(plan.duplicateEmails).toEqual(["same@school.test"]);
  });

  it("reports no duplicate emails when every email is distinct", () => {
    const plan = planAuthBackfill([src("a1"), src("a2")], [user("a1"), user("a2")]);
    expect(plan.duplicateEmails).toEqual([]);
  });
});

describe("planAuthBackfill — hashes stay out of everything printable", () => {
  it("does not log, and the hash appears only in writes[].account.password", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const plan = planAuthBackfill(
        [src("a1", { passwordHash: HASH_B }), src("ghost", { passwordHash: HASH_A })],
        [user("a1"), user("lonely")]
      );

      expect(log).not.toHaveBeenCalled();
      expect(err).not.toHaveBeenCalled();
      expect(warn).not.toHaveBeenCalled();

      const { writes, ...printable } = plan;
      const printed = JSON.stringify(printable);
      expect(printed).not.toContain(HASH_A);
      expect(printed).not.toContain(HASH_B);
      expect(JSON.stringify(writes)).toContain(HASH_B);
      // The orphan's hash never lands in a write at all.
      expect(JSON.stringify(writes)).not.toContain(HASH_A);
    } finally {
      log.mockRestore();
      err.mockRestore();
      warn.mockRestore();
    }
  });
});

describe("chunk", () => {
  it("splits into fixed-size batches with a short tail", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it("rejects a size below 1", () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});
