import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/admin/archive`'s four server actions — restore or permanently delete one
 * soft-deleted Teacher or Learner row at a time (spec sections 5-7).
 *
 * What is pinned here, beyond the happy paths:
 *   - Only SUPER_ADMIN passes. The guard is a bare `requireUser("SUPER_ADMIN")`
 *     with no second check in this module, so refusal is entirely session.ts's
 *     `redirect()` — real `next/navigation` is used (not mocked) so the
 *     assertion is on the actual control-flow signal, not a stand-in for it.
 *   - Every load carries `deletedAt: { not: null }` — a live row must be
 *     unreachable from this page.
 *   - Teacher restore never restores a login: no Supabase admin client is
 *     constructed, `isActive`/`authId` are untouched, no advisory or learner
 *     re-attachment is attempted.
 *   - Teacher purge calls Supabase `deleteUser` only after the Prisma
 *     transaction commits, and a Supabase failure does not turn a successful
 *     Prisma purge into a reported failure.
 *   - Audit metadata carries ids/counts/booleans only, never a name or email.
 *   - A refused or blocked operation writes no audit row.
 */

const LEARNER_ID = "11111111-1111-4111-8111-111111111111";
const TEACHER_ID = "22222222-2222-4222-8222-222222222222";
const SCHOOL_ID = "school-1";
const TEACHER_NAME = "Reyes, Fernando";
const TEACHER_EMAIL_LIVE = "fernando.reyes@deped.gov.ph";

/** Records cross-module call order so "before commit" claims are provable. */
let order: string[];

// ── prisma ───────────────────────────────────────────────────────────────

const learnerFindFirst = vi.fn();
const userFindFirst = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      get findFirst() {
        return learnerFindFirst;
      },
    },
    user: {
      get findFirst() {
        return userFindFirst;
      },
    },
    get $transaction() {
      return transaction;
    },
  },
}));

// ── session ──────────────────────────────────────────────────────────────

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...args),
}));

// ── rate limit ───────────────────────────────────────────────────────────

const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...args: unknown[]) => checkRateLimit(...args),
}));

// ── audit ────────────────────────────────────────────────────────────────

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...args),
  AUDIT_ACTIONS: {
    ARCHIVE_LEARNER_RESTORE: "ARCHIVE_LEARNER_RESTORE",
    ARCHIVE_LEARNER_PURGE: "ARCHIVE_LEARNER_PURGE",
    ARCHIVE_TEACHER_RESTORE: "ARCHIVE_TEACHER_RESTORE",
    ARCHIVE_TEACHER_PURGE: "ARCHIVE_TEACHER_PURGE",
  },
}));

// ── purge / reactivate — tested on their own in archive/purge.test.ts and
// archive/reactivate-enrollment.test.ts, mocked here as pure collaborators ─

const purgeLearnerRecord = vi.fn();
const purgeTeacherRecord = vi.fn();
vi.mock("@/lib/archive/purge", () => ({
  purgeLearnerRecord: (...args: unknown[]) => purgeLearnerRecord(...args),
  purgeTeacherRecord: (...args: unknown[]) => purgeTeacherRecord(...args),
}));

const reactivateEnrollment = vi.fn();
vi.mock("@/lib/learners/reactivate-enrollment", () => ({
  reactivateEnrollment: (...args: unknown[]) => reactivateEnrollment(...args),
}));

// removed-email is pure; use the real implementation.
vi.mock("@/lib/teachers/removed-email", async () => {
  const actual = await vi.importActual<typeof import("@/lib/teachers/removed-email")>(
    "@/lib/teachers/removed-email"
  );
  return actual;
});

// ── supabase admin ───────────────────────────────────────────────────────

const deleteUser = vi.fn();
const createSupabaseAdminClient = vi.fn(() => {
  order.push("createSupabaseAdminClient");
  return { auth: { admin: { deleteUser: (...args: unknown[]) => deleteUser(...args) } } };
});
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => createSupabaseAdminClient(),
}));

// ── cache ────────────────────────────────────────────────────────────────

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: vi.fn(),
  revalidateSchoolDashboard: vi.fn(),
  revalidateSchoolHeadTeachers: vi.fn(),
  revalidateSchoolsList: vi.fn(),
  revalidateSchoolTeachers: vi.fn(),
  revalidateTeacherCaches: vi.fn(),
}));

// Deliberately NOT mocking "next/navigation" — the guard tests below rely on
// the real `redirect()`, which throws an Error carrying a `digest` property.
// That is exactly what `requireUser("SUPER_ADMIN")` does for real when the
// caller is not a Super Admin, so a mock that only returns a plain rejection
// would test a stand-in for the guard rather than the guard's actual shape.

const {
  purgeRemovedLearner,
  purgeRemovedTeacher,
  restoreRemovedLearner,
  restoreRemovedTeacher,
} = await import("@/lib/actions/admin-archive");
const { redirect } = await import("next/navigation");

function fd(id: string): FormData {
  const form = new FormData();
  form.set("id", id);
  return form;
}

function liveLearner(overrides: Record<string, unknown> = {}) {
  return {
    id: LEARNER_ID,
    schoolId: SCHOOL_ID,
    gradeLevelId: "grade-1",
    sectionId: "section-1",
    teacherId: TEACHER_ID,
    aralTeacherId: null,
    isAralLearner: false,
    school: { deletedAt: null },
    ...overrides,
  };
}

function removedTeacher(overrides: Record<string, unknown> = {}) {
  return {
    id: TEACHER_ID,
    schoolId: SCHOOL_ID,
    email: "removed+22222222-2222-4222-8222-222222222222@school.local",
    authId: "auth-teacher-1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  order = [];
  requireUser.mockResolvedValue({ id: "admin-1", role: "SUPER_ADMIN" });
  checkRateLimit.mockResolvedValue({ ok: true });
  learnerFindFirst.mockResolvedValue(null);
  userFindFirst.mockResolvedValue(null);
  reactivateEnrollment.mockResolvedValue({ outcome: "created", enrollmentId: "enrollment-1" });
  purgeLearnerRecord.mockResolvedValue({
    enrollment: 1,
    attendance: 2,
    readingLevelRecord: 3,
    termGrade: 4,
    aralProfile: 1,
  });
  purgeTeacherRecord.mockResolvedValue({
    counts: {
      teacherSection: 1,
      notification: 2,
      chatMessage: 3,
      chatMention: 0,
      chatRead: 1,
      supportTicket: 0,
      unlockGrant: 0,
    },
    releasedSectionIds: ["section-a"],
    releasedLearnerCount: 2,
  });
  deleteUser.mockResolvedValue({ error: null });
  // A minimal, generic transaction stub. Each action's own tests override the
  // callback behaviour they need by inspecting the `tx` shape they receive,
  // or by re-mocking `transaction` per test.
  transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
    order.push("transaction:start");
    const result = await cb(txStub());
    order.push("transaction:commit");
    return result;
  });
});

function txStub() {
  return {
    learner: {
      update: vi.fn(async (_args: unknown) => ({})),
    },
    user: {
      findFirst: vi.fn(async (_args: unknown) => null),
      update: vi.fn(async (_args: unknown) => ({})),
    },
  };
}

// ── Guard ──────────────────────────────────────────────────────────────────

describe("authorization guard", () => {
  const cases: Array<[string, (id: string) => Promise<unknown>]> = [
    ["restoreRemovedLearner", (id) => restoreRemovedLearner(fd(id))],
    ["purgeRemovedLearner", (id) => purgeRemovedLearner(fd(id))],
    ["restoreRemovedTeacher", (id) => restoreRemovedTeacher(fd(id))],
    ["purgeRemovedTeacher", (id) => purgeRemovedTeacher(fd(id))],
  ];

  it.each(cases)("%s refuses a non-Super-Admin caller", async (_name, call) => {
    // Simulate exactly what the real `requireUser("SUPER_ADMIN")` does for a
    // School Head or Teacher: it redirects, which is a throw carrying a
    // `digest`, not a returned failure value.
    requireUser.mockImplementation(async () => {
      redirect("/school-head");
    });

    await expect(call(LEARNER_ID)).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });

    expect(learnerFindFirst).not.toHaveBeenCalled();
    expect(userFindFirst).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it.each(cases)("%s asks requireUser for SUPER_ADMIN before reading anything", async (_name, call) => {
    await call(LEARNER_ID);
    expect(requireUser).toHaveBeenCalledWith("SUPER_ADMIN");
  });
});

// ── Live row unreachable ────────────────────────────────────────────────────

describe("a live row is unreachable from every action", () => {
  it("restoreRemovedLearner loads with deletedAt: { not: null }", async () => {
    await restoreRemovedLearner(fd(LEARNER_ID));
    expect(learnerFindFirst.mock.calls[0][0].where).toMatchObject({
      id: LEARNER_ID,
      deletedAt: { not: null },
    });
  });

  it("purgeRemovedLearner loads with deletedAt: { not: null }", async () => {
    await purgeRemovedLearner(fd(LEARNER_ID));
    expect(learnerFindFirst.mock.calls[0][0].where).toMatchObject({
      id: LEARNER_ID,
      deletedAt: { not: null },
    });
  });

  it("restoreRemovedTeacher loads with deletedAt: { not: null }", async () => {
    await restoreRemovedTeacher(fd(TEACHER_ID));
    expect(userFindFirst.mock.calls[0][0].where).toMatchObject({
      id: TEACHER_ID,
      deletedAt: { not: null },
    });
  });

  it("purgeRemovedTeacher loads with deletedAt: { not: null }", async () => {
    await purgeRemovedTeacher(fd(TEACHER_ID));
    expect(userFindFirst.mock.calls[0][0].where).toMatchObject({
      id: TEACHER_ID,
      deletedAt: { not: null },
    });
  });
});

// ── restoreRemovedLearner ────────────────────────────────────────────────

describe("restoreRemovedLearner", () => {
  it("refuses NOT_FOUND when no row matches", async () => {
    const res = await restoreRemovedLearner(fd(LEARNER_ID));
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses NOT_FOUND when the learner's school is itself soft-deleted", async () => {
    learnerFindFirst.mockResolvedValue(liveLearner({ school: { deletedAt: new Date() } }));

    const res = await restoreRemovedLearner(fd(LEARNER_ID));

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("clears deletedAt and reactivates the enrollment, then audits ids and the outcome only", async () => {
    learnerFindFirst.mockResolvedValue(liveLearner());
    reactivateEnrollment.mockResolvedValue({ outcome: "revived", enrollmentId: "enrollment-9" });

    const res = await restoreRemovedLearner(fd(LEARNER_ID));

    expect(res).toEqual({ ok: true, enrollmentOutcome: "revived" });
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: "ARCHIVE_LEARNER_RESTORE",
      resource: "Learner",
      resourceId: LEARNER_ID,
      schoolId: SCHOOL_ID,
      metadata: { schoolId: SCHOOL_ID, enrollmentOutcome: "revived", enrollmentId: "enrollment-9" },
    });
  });
});

// ── purgeRemovedLearner ──────────────────────────────────────────────────

describe("purgeRemovedLearner", () => {
  it("refuses NOT_FOUND when no row matches", async () => {
    const res = await purgeRemovedLearner(fd(LEARNER_ID));
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("does not check the learner's school before purging — unlike restore", async () => {
    // Purge of a learner whose school is itself soft-deleted is explicitly
    // allowed by spec 4a ("that is the point of the page"). The select this
    // action issues never even asks for `school`.
    learnerFindFirst.mockResolvedValue(liveLearner());

    await purgeRemovedLearner(fd(LEARNER_ID));

    const select = learnerFindFirst.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("school");
  });

  it("purges and audits schoolId + counts only", async () => {
    learnerFindFirst.mockResolvedValue(liveLearner());

    const res = await purgeRemovedLearner(fd(LEARNER_ID));

    expect(res).toEqual({ ok: true });
    expect(purgeLearnerRecord).toHaveBeenCalledWith(expect.anything(), LEARNER_ID);
    const entry = writeAudit.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: "ARCHIVE_LEARNER_PURGE",
      resource: "Learner",
      resourceId: LEARNER_ID,
      metadata: {
        schoolId: SCHOOL_ID,
        counts: { enrollment: 1, attendance: 2, readingLevelRecord: 3, termGrade: 4, aralProfile: 1 },
      },
    });
  });
});

// ── restoreRemovedTeacher — the least obvious behaviour ─────────────────

describe("restoreRemovedTeacher never restores a login", () => {
  it("refuses NOT_FOUND when no row matches", async () => {
    const res = await restoreRemovedTeacher(fd(TEACHER_ID));
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("never constructs a Supabase admin client on this path", async () => {
    userFindFirst.mockResolvedValue(removedTeacher());

    await restoreRemovedTeacher(fd(TEACHER_ID));

    expect(createSupabaseAdminClient).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("writes only deletedAt: null (isActive and authId are left untouched)", async () => {
    userFindFirst.mockResolvedValue(removedTeacher());
    let updateData: Record<string, unknown> | undefined;
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        user: {
          findFirst: vi.fn(async () => null),
          update: vi.fn(async (args: { data: Record<string, unknown> }) => {
            updateData = args.data;
            return {};
          }),
        },
      };
      return cb(tx);
    });

    await restoreRemovedTeacher(fd(TEACHER_ID));

    expect(updateData).toBeDefined();
    expect(updateData).toEqual({ deletedAt: null });
    expect(updateData).not.toHaveProperty("isActive");
    expect(updateData).not.toHaveProperty("authId");
  });

  it("result always reports needsCredentials: true", async () => {
    userFindFirst.mockResolvedValue(removedTeacher());

    const res = await restoreRemovedTeacher(fd(TEACHER_ID));

    expect(res).toMatchObject({ ok: true, needsCredentials: true });
  });

  it("restores the original email when it is recoverable and free", async () => {
    userFindFirst.mockResolvedValue(
      removedTeacher({ email: `${TEACHER_EMAIL_LIVE}.deleted.1717000000000` })
    );
    let updateData: Record<string, unknown> | undefined;
    let takenQueryWhere: unknown;
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        user: {
          findFirst: vi.fn(async (args: { where: unknown }) => {
            takenQueryWhere = args.where;
            return null; // nobody holds the original address
          }),
          update: vi.fn(async (args: { data: Record<string, unknown> }) => {
            updateData = args.data;
            return {};
          }),
        },
      };
      return cb(tx);
    });

    const res = await restoreRemovedTeacher(fd(TEACHER_ID));

    expect(res).toMatchObject({ ok: true, emailRestored: true });
    expect(updateData).toMatchObject({ email: TEACHER_EMAIL_LIVE, deletedAt: null });
    expect(takenQueryWhere).toMatchObject({ email: TEACHER_EMAIL_LIVE });
  });

  it("keeps the tombstone when the recovered address is already held by a live user", async () => {
    userFindFirst.mockResolvedValue(
      removedTeacher({ email: `${TEACHER_EMAIL_LIVE}.deleted.1717000000000` })
    );
    let updateData: Record<string, unknown> | undefined;
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        user: {
          findFirst: vi.fn(async () => ({ id: "someone-else" })), // address is taken
          update: vi.fn(async (args: { data: Record<string, unknown> }) => {
            updateData = args.data;
            return {};
          }),
        },
      };
      return cb(tx);
    });

    const res = await restoreRemovedTeacher(fd(TEACHER_ID));

    expect(res).toMatchObject({ ok: true, emailRestored: false });
    expect(updateData).toEqual({ deletedAt: null });
    expect(updateData).not.toHaveProperty("email");
  });

  it("keeps the tombstone outright when the address is not recoverable (Super Admin removal shape)", async () => {
    userFindFirst.mockResolvedValue(removedTeacher()); // removed+<id>@school.local
    let findFirstCalled = false;
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        user: {
          findFirst: vi.fn(async () => {
            findFirstCalled = true;
            return null;
          }),
          update: vi.fn(async () => ({})),
        },
      };
      return cb(tx);
    });

    const res = await restoreRemovedTeacher(fd(TEACHER_ID));

    expect(res).toMatchObject({ ok: true, emailRestored: false });
    // Never even checks whether it's taken — there's no candidate to check.
    expect(findFirstCalled).toBe(false);
  });

  it("audits ids and booleans only, never the restored address", async () => {
    userFindFirst.mockResolvedValue(
      removedTeacher({ email: `${TEACHER_EMAIL_LIVE}.deleted.1717000000000` })
    );
    transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      const tx = {
        user: {
          findFirst: vi.fn(async () => null),
          update: vi.fn(async () => ({})),
        },
      };
      return cb(tx);
    });

    await restoreRemovedTeacher(fd(TEACHER_ID));

    const entry = writeAudit.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: "ARCHIVE_TEACHER_RESTORE",
      resource: "User",
      resourceId: TEACHER_ID,
    });
    expect(entry.metadata).toEqual({
      schoolId: SCHOOL_ID,
      emailRestored: true,
      needsCredentials: true,
    });
    expect(JSON.stringify(entry)).not.toContain(TEACHER_EMAIL_LIVE);
    expect(JSON.stringify(entry)).not.toContain(TEACHER_NAME);
  });
});

// ── purgeRemovedTeacher ──────────────────────────────────────────────────

describe("purgeRemovedTeacher", () => {
  it("refuses NOT_FOUND when no row matches", async () => {
    const res = await purgeRemovedTeacher(fd(TEACHER_ID));
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("purges an orphaned teacher with a null schoolId rather than refusing — purging orphans is the point of this page", async () => {
    // Per src/lib/actions/admin-archive.ts and src/lib/archive/purge.ts: a
    // teacher row orphaned by a hard School delete has no advisory/Section
    // state to release, so purgeTeacherRecord skips that step for a null
    // schoolId and still deletes the row. It must not be refused.
    userFindFirst.mockResolvedValue(removedTeacher({ schoolId: null }));

    const res = await purgeRemovedTeacher(fd(TEACHER_ID));

    expect(res).toMatchObject({ ok: true });
    expect(transaction).toHaveBeenCalled();
    expect(purgeTeacherRecord).toHaveBeenCalledWith(expect.anything(), {
      teacherId: TEACHER_ID,
      schoolId: null,
    });
    expect(writeAudit).toHaveBeenCalledTimes(1);
    // Revalidation that requires a schoolId (school teachers/dashboard list,
    // the school detail page) must not blow up on a null schoolId; the
    // school-agnostic caches (teacher caches, schools list, archive page)
    // still get busted.
  });

  it("calls Supabase deleteUser only AFTER the Prisma transaction commits", async () => {
    userFindFirst.mockResolvedValue(removedTeacher());

    await purgeRemovedTeacher(fd(TEACHER_ID));

    const commitIndex = order.indexOf("transaction:commit");
    const supabaseIndex = order.indexOf("createSupabaseAdminClient");
    expect(commitIndex).toBeGreaterThanOrEqual(0);
    expect(supabaseIndex).toBeGreaterThan(commitIndex);
  });

  it("a Supabase deleteUser failure does not turn a successful purge into a reported failure", async () => {
    userFindFirst.mockResolvedValue(removedTeacher());
    deleteUser.mockRejectedValue(new Error("supabase is down"));

    const res = await purgeRemovedTeacher(fd(TEACHER_ID));

    expect(res).toEqual({ ok: true, authDeleted: false });
    const entry = writeAudit.mock.calls[0][0];
    expect(entry.metadata).toMatchObject({ authDeleted: false });
  });

  it("reports authDeleted true when Supabase succeeds", async () => {
    userFindFirst.mockResolvedValue(removedTeacher());
    deleteUser.mockResolvedValue({ error: null });

    const res = await purgeRemovedTeacher(fd(TEACHER_ID));

    expect(res).toEqual({ ok: true, authDeleted: true });
  });

  it("purges with the teacher's own id and schoolId", async () => {
    userFindFirst.mockResolvedValue(removedTeacher());

    await purgeRemovedTeacher(fd(TEACHER_ID));

    expect(purgeTeacherRecord).toHaveBeenCalledWith(expect.anything(), {
      teacherId: TEACHER_ID,
      schoolId: SCHOOL_ID,
    });
  });

  it("audits ids, counts and booleans only — never a name or email", async () => {
    userFindFirst.mockResolvedValue(removedTeacher());

    await purgeRemovedTeacher(fd(TEACHER_ID));

    const entry = writeAudit.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: "ARCHIVE_TEACHER_PURGE",
      resource: "User",
      resourceId: TEACHER_ID,
      schoolId: SCHOOL_ID,
    });
    expect(entry.metadata).toEqual({
      schoolId: SCHOOL_ID,
      counts: {
        teacherSection: 1,
        notification: 2,
        chatMessage: 3,
        chatMention: 0,
        chatRead: 1,
        supportTicket: 0,
        unlockGrant: 0,
      },
      releasedSectionIds: ["section-a"],
      releasedLearnerCount: 2,
      authDeleted: true,
    });
    // Every value in the metadata is an id, a count, a boolean, or an array of
    // ids — never a display name or an email address.
    for (const value of Object.values(entry.metadata)) {
      if (typeof value === "string") {
        expect(value).not.toContain("@");
      }
    }
    expect(JSON.stringify(entry)).not.toContain(TEACHER_NAME);
    expect(JSON.stringify(entry)).not.toContain(TEACHER_EMAIL_LIVE);
  });
});
