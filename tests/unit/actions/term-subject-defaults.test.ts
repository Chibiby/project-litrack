import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { MAX_ACTIVE_SUBJECTS_PER_GRADE } from "@/lib/terms/subjects";

/**
 * Action-level coverage for the Super Admin per-`GradeLevelType` End of Terms
 * subject template console (`src/lib/actions/term-subject-defaults.ts`).
 *
 * Unlike `term-subjects.ts`, there is no School Head path and no `schoolId`
 * anywhere in this table: `requireUser("SUPER_ADMIN")` is the only guard, and
 * every audit row is written with `schoolId: null`.
 *
 * Deliberately NOT mocking "next/navigation" for the guard tests — the real
 * `redirect()` (which `requireUser("SUPER_ADMIN")` calls for a non-Super-Admin)
 * throws an Error carrying a `digest`, and that is the actual shape of the
 * refusal, not a stand-in for it (mirrors `tests/unit/actions/admin-archive.test.ts`).
 *
 * `getAllTermSubjectDefaults` (`src/lib/terms/subject-defaults-db.ts`) and
 * `nextPosition`/`planSubjectReorder` (`src/lib/terms/subjects.ts`) are real
 * code here — only their leaf, `prisma.termSubjectDefault.*`, is a fake.
 */

const TYPE = "G7";
const OTHER_TYPE = "G8";

type DefaultRow = {
  id: string;
  gradeLevelType: string;
  name: string;
  position: number;
  deletedAt: Date | null;
};

let defaults: DefaultRow[];
let session: { id: string; role: "SUPER_ADMIN" | "SCHOOL_HEAD" | "TEACHER"; schoolId: string | null };

const ADMIN = { id: "admin-1", role: "SUPER_ADMIN" as const, schoolId: null };

const nameKey = (name: string) => name.trim().toLowerCase();

function row(overrides: Partial<DefaultRow> & { id: string; name: string }): DefaultRow {
  return { gradeLevelType: TYPE, position: 0, deletedAt: null, ...overrides };
}

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}

// ── prisma ───────────────────────────────────────────────────────────────

const findFirst = vi.fn(async (args: { where: { id: string } }) => {
  const found = defaults.find((d) => d.id === args.where.id);
  return found
    ? { id: found.id, name: found.name, gradeLevelType: found.gradeLevelType, deletedAt: found.deletedAt }
    : null;
});

/** `getAllTermSubjectDefaults` reads through this — every row for a type, active+archived. */
const findMany = vi.fn(async (args: { where: { gradeLevelType: string } }) =>
  defaults
    .filter((d) => d.gradeLevelType === args.where.gradeLevelType)
    .map((d) => ({ id: d.id, name: d.name, position: d.position, deletedAt: d.deletedAt }))
);

let nextCreatedId = 0;
const create = vi.fn(
  async (args: { data: { gradeLevelType: string; name: string; position: number }; select?: unknown }) => {
    const clash = defaults.some(
      (d) =>
        d.gradeLevelType === args.data.gradeLevelType &&
        d.deletedAt === null &&
        nameKey(d.name) === nameKey(args.data.name)
    );
    if (clash) throw p2002();
    const id = `default-new-${++nextCreatedId}`;
    defaults.push({
      id,
      gradeLevelType: args.data.gradeLevelType,
      name: args.data.name,
      position: args.data.position,
      deletedAt: null,
    });
    return { id };
  }
);

/** Backs rename/archive (top-level) and restore/reorder (through `tx`). */
const updateMany = vi.fn(
  async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const { where, data } = args;
    const matches = defaults.filter((d) => {
      if ("id" in where && d.id !== where.id) return false;
      if ("gradeLevelType" in where && d.gradeLevelType !== where.gradeLevelType) return false;
      if (where.deletedAt === null && d.deletedAt !== null) return false;
      const notClause = where.deletedAt as { not: null } | undefined;
      if (notClause && typeof notClause === "object" && "not" in notClause && d.deletedAt === null)
        return false;
      return true;
    });
    if (matches.length === 0) return { count: 0 };

    const renaming = typeof data.name === "string";
    const activating = "deletedAt" in data && data.deletedAt === null;
    if (renaming || activating) {
      for (const m of matches) {
        const willBeActive = activating ? true : m.deletedAt === null;
        if (!willBeActive) continue;
        const newName = renaming ? (data.name as string) : m.name;
        const clash = defaults.some(
          (d) =>
            d !== m &&
            d.gradeLevelType === m.gradeLevelType &&
            d.deletedAt === null &&
            nameKey(d.name) === nameKey(newName)
        );
        if (clash) throw p2002();
      }
    }

    for (const m of matches) {
      if (typeof data.name === "string") m.name = data.name;
      if ("deletedAt" in data) m.deletedAt = data.deletedAt as Date | null;
      if (typeof data.position === "number") m.position = data.position;
    }
    return { count: matches.length };
  }
);

/** `lockType`'s advisory lock — result ignored by the action. */
const txExecuteRaw = vi.fn(async (..._args: unknown[]) => 1);

function makeTx() {
  return {
    $executeRaw: (...args: unknown[]) => txExecuteRaw(...(args as [never])),
    termSubjectDefault: {
      findMany: (...args: unknown[]) => findMany(...(args as [never])),
      create: (...args: unknown[]) => create(...(args as [never])),
      updateMany: (...args: unknown[]) => updateMany(...(args as [never])),
    },
  };
}

const transaction = vi.fn(async (cb: (tx: ReturnType<typeof makeTx>) => unknown) =>
  cb(makeTx())
);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    termSubjectDefault: {
      findFirst: (...args: unknown[]) => findFirst(...(args as [never])),
      updateMany: (...args: unknown[]) => updateMany(...(args as [never])),
    },
  },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...(args as [])),
}));

const writeAudit = vi.fn(
  async (_entry: {
    userId: string;
    schoolId: string | null;
    action: string;
    resource: string;
    resourceId: string | null;
    metadata: Record<string, unknown>;
  }) => {}
);
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [never])),
  AUDIT_ACTIONS: {
    TERM_SUBJECT_DEFAULT_CREATE: "TERM_SUBJECT_DEFAULT_CREATE",
    TERM_SUBJECT_DEFAULT_RENAME: "TERM_SUBJECT_DEFAULT_RENAME",
    TERM_SUBJECT_DEFAULT_ARCHIVE: "TERM_SUBJECT_DEFAULT_ARCHIVE",
    TERM_SUBJECT_DEFAULT_RESTORE: "TERM_SUBJECT_DEFAULT_RESTORE",
    TERM_SUBJECT_DEFAULT_REORDER: "TERM_SUBJECT_DEFAULT_REORDER",
  },
}));

const revalidateTermSubjectDefaults = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateTermSubjectDefaults: (...args: unknown[]) =>
    revalidateTermSubjectDefaults(...(args as [])),
}));

// Deliberately NOT mocking "next/navigation" — see file header.

const {
  createTermSubjectDefault,
  renameTermSubjectDefault,
  archiveTermSubjectDefault,
  restoreTermSubjectDefault,
  reorderTermSubjectDefaults,
} = await import("@/lib/actions/term-subject-defaults");
const { redirect } = await import("next/navigation");

/** Nothing changed: no write, no audit, no cache bust. */
function expectNoWrite() {
  expect(create).not.toHaveBeenCalled();
  expect(updateMany).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
  expect(revalidateTermSubjectDefaults).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  // `vi.clearAllMocks()` clears call records but not an override installed by
  // `mockImplementation` — restore the default read-the-session behaviour so
  // one test's `redirect()` override never leaks into the next.
  requireUser.mockImplementation(async () => session);
  nextCreatedId = 0;
  defaults = [
    row({ id: "default-english", name: "English", position: 0 }),
    row({ id: "default-math", name: "Mathematics", position: 1 }),
  ];
  session = ADMIN;
});

describe("authorization guard", () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["createTermSubjectDefault", () => createTermSubjectDefault({ gradeLevelType: TYPE, name: "New" })],
    ["renameTermSubjectDefault", () => renameTermSubjectDefault({ id: "default-english", name: "New" })],
    ["archiveTermSubjectDefault", () => archiveTermSubjectDefault({ id: "default-english" })],
    ["restoreTermSubjectDefault", () => restoreTermSubjectDefault({ id: "default-english" })],
    [
      "reorderTermSubjectDefaults",
      () => reorderTermSubjectDefaults({ gradeLevelType: TYPE, orderedIds: ["default-english"] }),
    ],
  ];

  it.each(cases)("%s refuses a non-Super-Admin caller", async (_name, call) => {
    // Exactly what the real `requireUser("SUPER_ADMIN")` does for a School
    // Head or Teacher: a redirect, which is a throw carrying a `digest`, not
    // a returned `{ ok: false }`.
    requireUser.mockImplementation(async () => {
      redirect("/school-head");
    });

    await expect(call()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expectNoWrite();
  });

  it.each(cases)("%s asks requireUser for SUPER_ADMIN before reading anything", async (_name, call) => {
    await call();
    expect(requireUser).toHaveBeenCalledWith("SUPER_ADMIN");
  });
});

describe("createTermSubjectDefault", () => {
  it("refuses FLOATING with VALIDATION_FAILED before any query runs", async () => {
    const res = await createTermSubjectDefault({ gradeLevelType: "FLOATING", name: "English" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expectNoWrite();
  });

  it("refuses a duplicate name within the same type, case- and whitespace-insensitively", async () => {
    const res = await createTermSubjectDefault({ gradeLevelType: TYPE, name: "  english  " });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.fieldErrors?.name).toBeTruthy();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(revalidateTermSubjectDefaults).not.toHaveBeenCalled();
  });

  it("allows the same name on a DIFFERENT grade level type", async () => {
    const res = await createTermSubjectDefault({ gradeLevelType: OTHER_TYPE, name: "English" });
    expect(res.ok).toBe(true);
  });

  it("refuses the 16th active default for one type with VALIDATION_FAILED", async () => {
    defaults = Array.from({ length: MAX_ACTIVE_SUBJECTS_PER_GRADE }, (_, i) =>
      row({ id: `default-${i}`, name: `Subject ${i}`, position: i })
    );

    const res = await createTermSubjectDefault({ gradeLevelType: TYPE, name: "One Too Many" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.error).toContain(`${MAX_ACTIVE_SUBJECTS_PER_GRADE}`);
    expectNoWrite();
  });

  it("takes the grade type lock with $executeRaw — $queryRaw cannot read pg_advisory_xact_lock's void result", async () => {
    const res = await createTermSubjectDefault({ gradeLevelType: TYPE, name: "GMRC" });
    expect(res.ok).toBe(true);
    expect(txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(String((txExecuteRaw.mock.calls[0][0] as TemplateStringsArray).join("?"))).toContain(
      "pg_advisory_xact_lock"
    );
  });

  it("accepts exactly the 15th default for a type", async () => {
    defaults = Array.from({ length: MAX_ACTIVE_SUBJECTS_PER_GRADE - 1 }, (_, i) =>
      row({ id: `default-${i}`, name: `Subject ${i}`, position: i })
    );

    const res = await createTermSubjectDefault({ gradeLevelType: TYPE, name: "The 15th" });
    expect(res.ok).toBe(true);
  });

  it("writes the audit row with schoolId: null — this table has no tenant", async () => {
    const res = await createTermSubjectDefault({ gradeLevelType: TYPE, name: "New Subject" });

    expect(res.ok).toBe(true);
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.action).toBe("TERM_SUBJECT_DEFAULT_CREATE");
    expect(audit.schoolId).toBeNull();
    expect(audit.metadata).toMatchObject({ gradeLevelType: TYPE, name: "New Subject" });
    expect(revalidateTermSubjectDefaults).toHaveBeenCalledTimes(1);
  });
});

describe("renameTermSubjectDefault", () => {
  it("refuses renaming into another active default's name in the same type", async () => {
    const res = await renameTermSubjectDefault({ id: "default-math", name: "English" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.fieldErrors?.name).toBeTruthy();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses an already-archived default as NOT_FOUND", async () => {
    defaults.push(row({ id: "default-archived", name: "Old", deletedAt: new Date(2026, 8, 1) }));

    const res = await renameTermSubjectDefault({ id: "default-archived", name: "New Name" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });

  it("refuses an unknown id as NOT_FOUND", async () => {
    const res = await renameTermSubjectDefault({ id: "does-not-exist", name: "New Name" });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("audits with schoolId: null and the old/new names", async () => {
    const res = await renameTermSubjectDefault({ id: "default-english", name: "English Language" });

    expect(res.ok).toBe(true);
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.schoolId).toBeNull();
    expect(audit.metadata).toMatchObject({ oldName: "English", newName: "English Language" });
  });
});

describe("archiveTermSubjectDefault", () => {
  it("refuses archiving an already-archived default as NOT_FOUND", async () => {
    defaults.push(row({ id: "default-archived", name: "Old", deletedAt: new Date(2026, 8, 1) }));

    const res = await archiveTermSubjectDefault({ id: "default-archived" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });

  it("archives an active default and audits with schoolId: null", async () => {
    const res = await archiveTermSubjectDefault({ id: "default-english" });

    expect(res.ok).toBe(true);
    expect(defaults.find((d) => d.id === "default-english")?.deletedAt).toBeInstanceOf(Date);
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.action).toBe("TERM_SUBJECT_DEFAULT_ARCHIVE");
    expect(audit.schoolId).toBeNull();
    expect(revalidateTermSubjectDefaults).toHaveBeenCalledTimes(1);
  });
});

describe("restoreTermSubjectDefault", () => {
  it("refuses restoring an already-active default as NOT_FOUND", async () => {
    const res = await restoreTermSubjectDefault({ id: "default-english" });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });

  it("refuses a restore that would collide with an active default's name", async () => {
    defaults.push(row({ id: "archived-english", name: "English", deletedAt: new Date(2026, 8, 1) }));

    const res = await restoreTermSubjectDefault({ id: "archived-english" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.fieldErrors?.name).toBeTruthy();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(defaults.find((d) => d.id === "archived-english")?.deletedAt).not.toBeNull();
  });

  it("refuses restoring into a type already at the 15-default cap", async () => {
    defaults = Array.from({ length: MAX_ACTIVE_SUBJECTS_PER_GRADE }, (_, i) =>
      row({ id: `default-${i}`, name: `Subject ${i}`, position: i })
    );
    defaults.push(row({ id: "archived-extra", name: "Extra", deletedAt: new Date(2026, 8, 1) }));

    const res = await restoreTermSubjectDefault({ id: "archived-extra" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.error).toContain(`${MAX_ACTIVE_SUBJECTS_PER_GRADE}`);
    expect(defaults.find((d) => d.id === "archived-extra")?.deletedAt).not.toBeNull();
  });

  it("places a restored default after every currently-active one, and audits with schoolId: null", async () => {
    defaults.push(
      row({ id: "archived-reading", name: "Reading Club", position: 5, deletedAt: new Date(2026, 8, 1) })
    );

    const res = await restoreTermSubjectDefault({ id: "archived-reading" });

    expect(res.ok).toBe(true);
    const restored = defaults.find((d) => d.id === "archived-reading")!;
    expect(restored.deletedAt).toBeNull();
    expect(restored.position).toBe(2); // active positions were 0 and 1
    expect(writeAudit.mock.calls[0][0].schoolId).toBeNull();
  });
});

describe("reorderTermSubjectDefaults", () => {
  it("reorders active defaults into the posted order and audits with schoolId: null", async () => {
    const res = await reorderTermSubjectDefaults({
      gradeLevelType: TYPE,
      orderedIds: ["default-math", "default-english"],
    });

    expect(res.ok).toBe(true);
    expect(defaults.find((d) => d.id === "default-math")!.position).toBe(0);
    expect(defaults.find((d) => d.id === "default-english")!.position).toBe(1);
    expect(writeAudit.mock.calls[0][0].schoolId).toBeNull();
    expect(revalidateTermSubjectDefaults).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale reorder (an id no longer active) with VALIDATION_FAILED", async () => {
    const res = await reorderTermSubjectDefaults({
      gradeLevelType: TYPE,
      orderedIds: ["default-english", "default-does-not-exist"],
    });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
