import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Action-level coverage for `saveMosyDecision`.
 *
 * Load-bearing choices:
 *   - The Zod schema, `resolveMosySave`, `assertSameSchool`, `action()` and the
 *     error catalog are all REAL. Only I/O is faked, so a fixture typo cannot turn
 *     into a green test through a mocked decision layer.
 *   - Writes are only reachable through `tx` (the interactive transaction). The
 *     top-level `prisma` fake exposes `$transaction` and nothing else, so a write
 *     that escaped the transaction would throw and fail the case.
 *   - Every success case asserts `result` before any negative call assertion, so a
 *     bailed-out action cannot make a `not.toHaveBeenCalled` vacuous.
 */

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TUTOR = "22222222-2222-4222-8222-222222222222";
const SCHOOL_ID = "school-1";
const OTHER_SCHOOL = "school-2";
const LEARNER_ID = "3f0c8f0e-6a55-4c1e-9d55-0d3a6a1f2b10";
const YEAR_ID = "year-1";
const GRADE_ID = "grade-4";
const ADVISER_ID = "adviser-1";
const ENROLLED = new Date("2026-06-10T00:00:00.000Z");
const YEAR_START = new Date(2026, 5, 8); // local midnight, as the page derives it

type LearnerRow = {
  schoolId: string;
  teacherId: string | null;
  gradeLevelId: string;
  isAralLearner: boolean;
  aralTeacherId: string | null;
  aralEnrolledAt: Date | null;
  gradeLevel: { type: string };
};
type Existing = { decision: "MOVE_OUT" | "STAY" | null; tutorId: string | null; priorAralEnrolledAt: Date | null };

let learnerRow: LearnerRow | null;
let existingRow: Existing | null;
let activeYear: { id: string; startDate: Date } | null;
/** Filipino profile of the DB's latest reading record (null = no record). */
let dbPreviousFilipino: string | null;
/** Ordered log of every tx write, to prove both happen on the same transaction. */
let txLog: { tx: number; op: string; args: unknown }[];
let txCounter: number;

/** Order of the lock and the two reads inside the transaction. */
let readOrder: string[];
const lockCall = vi.fn();
const learnerFindFirst = vi.fn();
const learnerUpdate = vi.fn();
const upsert = vi.fn();
const findUnique = vi.fn();
const yearFindFirst = vi.fn();
const readingFindFirst = vi.fn();

function makeTx() {
  const id = ++txCounter;
  return {
    readingLevelRecord: {
      findFirst: (a: unknown) => {
        readingFindFirst(a);
        readOrder.push("previous.read");
        return Promise.resolve(
          dbPreviousFilipino === null ? null : { filipinoProfile: dbPreviousFilipino }
        );
      },
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      lockCall(strings.join("?"), values);
      readOrder.push("lock");
      return Promise.resolve([]);
    },
    schoolYear: {
      findFirst: (a: unknown) => {
        yearFindFirst(a);
        return Promise.resolve(activeYear);
      },
    },
    learner: {
      findFirst: (a: { where: { id: string } }) => {
        learnerFindFirst(a);
        readOrder.push("learner.read");
        return Promise.resolve(learnerRow && a.where.id === LEARNER_ID ? { ...learnerRow } : null);
      },
      update: (a: unknown) => {
        learnerUpdate(a);
        txLog.push({ tx: id, op: "learner.update", args: a });
        return Promise.resolve({});
      },
    },
    aralMosyDecision: {
      findUnique: (a: unknown) => {
        findUnique(a);
        readOrder.push("decision.read");
        return Promise.resolve(existingRow);
      },
      upsert: (a: unknown) => {
        upsert(a);
        txLog.push({ tx: id, op: "upsert", args: a });
        return Promise.resolve({});
      },
    },
  };
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (cb: (tx: ReturnType<typeof makeTx>) => Promise<unknown>) => cb(makeTx()),
  },
}));

const requireSchoolUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...a: unknown[]) => requireSchoolUser(...a),
}));

const writeAudit = vi.fn(async () => {});
vi.mock("@/lib/audit", async () => {
  const actions = await import("@/lib/audit-actions");
  return { writeAudit: (...a: unknown[]) => writeAudit(...(a as [])), AUDIT_ACTIONS: actions.AUDIT_ACTIONS };
});

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => revalidatePath(...a),
}));

const revalidateLearnerScoped = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: (...a: unknown[]) => revalidateLearnerScoped(...a),
}));

// Non-user errors would otherwise reach the ErrorEvent writer.
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "REF-1") }));

const { saveMosyDecision } = await import("@/lib/actions/aral-mosy");
const { ARAL_MOSY_HREF, ARAL_PROFILING_HREF } = await import("@/lib/nav/nav-config");

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set("learnerId", LEARNER_ID);
  fd.set("mosyLevel", "INSTRUCTIONAL_DEVELOPING");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const taggedLearner = (over: Partial<LearnerRow> = {}): LearnerRow => ({
  schoolId: SCHOOL_ID,
  teacherId: ADVISER_ID,
  gradeLevelId: GRADE_ID,
  isAralLearner: true,
  aralTeacherId: USER_ID,
  aralEnrolledAt: ENROLLED,
  gradeLevel: { type: "G4" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  txCounter = 0;
  txLog = [];
  readOrder = [];
  activeYear = { id: YEAR_ID, startDate: YEAR_START };
  dbPreviousFilipino = null;
  learnerRow = taggedLearner();
  existingRow = null;
  requireSchoolUser.mockResolvedValue({ id: USER_ID, schoolId: SCHOOL_ID, role: "TEACHER" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveMosyDecision — guards", () => {
  it("requires a TEACHER school user", async () => {
    await saveMosyDecision(form({ decision: "STAY" }));
    expect(requireSchoolUser).toHaveBeenCalledWith("TEACHER");
  });

  it("returns SCHOOL_YEAR_NOT_ACTIVE with no active year and writes nothing", async () => {
    activeYear = null;
    const res = await saveMosyDecision(form({ decision: "STAY" }));
    expect(res).toMatchObject({ ok: false, code: "SCHOOL_YEAR_NOT_ACTIVE" });
    expect(yearFindFirst).toHaveBeenCalledWith({
      where: { schoolId: SCHOOL_ID, isActive: true },
      select: { id: true, startDate: true },
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(learnerUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("another school's learner is NOT_FOUND and nothing is written", async () => {
    learnerRow = taggedLearner({ schoolId: OTHER_SCHOOL });
    const res = await saveMosyDecision(
      form({ decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN" })
    );
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(upsert).not.toHaveBeenCalled();
    expect(learnerUpdate).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateLearnerScoped).not.toHaveBeenCalled();
  });

  it("a missing / archived / deleted learner is NOT_FOUND", async () => {
    learnerRow = null;
    const res = await saveMosyDecision(form({ decision: "STAY" }));
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("locks the learner row (school-scoped, FOR UPDATE) before reading learner and decision", async () => {
    const res = await saveMosyDecision(form({ decision: "STAY" }));
    expect(res).toMatchObject({ ok: true });
    expect(lockCall).toHaveBeenCalledTimes(1);
    const [sql, values] = lockCall.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('FROM "Learner"');
    expect(sql).toContain("FOR UPDATE");
    expect(values).toEqual([LEARNER_ID, SCHOOL_ID]);
    expect(readOrder).toEqual(["lock", "learner.read", "decision.read", "previous.read"]);
  });

  it("looks up the previous Filipino level after the row lock, for this learner and the year start", async () => {
    const res = await saveMosyDecision(form({ decision: "STAY" }));
    expect(res).toMatchObject({ ok: true });
    expect(readOrder.indexOf("lock")).toBe(0);
    expect(readOrder.indexOf("previous.read")).toBeGreaterThan(readOrder.indexOf("lock"));
    expect(readingFindFirst).toHaveBeenCalledTimes(1);
    const arg = readingFindFirst.mock.calls[0][0];
    expect(arg.where.learnerId).toBe(LEARNER_ID);
    expect(arg.where.weekStart.gte).toEqual(YEAR_START);
    expect(arg.orderBy).toEqual({ weekStart: "desc" });
  });

  it("filters deleted and archived learners in the query", async () => {
    await saveMosyDecision(form({ decision: "STAY" }));
    expect(learnerFindFirst.mock.calls[0][0].where).toEqual({
      id: LEARNER_ID,
      deletedAt: null,
      archivedAt: null,
    });
  });

  it("an adviser who is not the designated tutor gets NOT_FOUND", async () => {
    learnerRow = taggedLearner({ teacherId: USER_ID, aralTeacherId: OTHER_TUTOR });
    const res = await saveMosyDecision(form({ decision: "STAY" }));
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(upsert).not.toHaveBeenCalled();
    expect(learnerUpdate).not.toHaveBeenCalled();
  });

  it("a Super Admin-like session (not the tutor) can never save, even with a forged post", async () => {
    requireSchoolUser.mockResolvedValue({ id: "sa-1", schoolId: SCHOOL_ID, role: "SUPER_ADMIN" });
    const res = await saveMosyDecision(form({ decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN" }));
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(upsert).not.toHaveBeenCalled();
    expect(learnerUpdate).not.toHaveBeenCalled();
  });

  it("MOVE_OUT without a reason is a VALIDATION_FAILED on reason and writes nothing", async () => {
    const res = await saveMosyDecision(form({ decision: "MOVE_OUT" }));
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect((res as { fieldErrors?: Record<string, string> }).fieldErrors).toHaveProperty("reason");
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(["IMPROVED_EARLY_GRADES", "IMPROVED_UPPER_GRADES"])(
    "legacy reason %s is VALIDATION_FAILED with a reason field error, learner untouched",
    async (reason) => {
      const res = await saveMosyDecision(form({ decision: "MOVE_OUT", reason }));
      expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
      expect((res as { fieldErrors?: Record<string, string> }).fieldErrors).toHaveProperty("reason");
      expect(upsert).not.toHaveBeenCalled();
      expect(learnerUpdate).not.toHaveBeenCalled();
      expect(writeAudit).not.toHaveBeenCalled();
    }
  );

  it("IMPROVED_READING_LEVEL without a level is VALIDATION_FAILED on reason and writes nothing", async () => {
    const res = await saveMosyDecision(
      form({ decision: "MOVE_OUT", reason: "IMPROVED_READING_LEVEL" })
    );
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect((res as { fieldErrors?: Record<string, string> }).fieldErrors).toHaveProperty("reason");
    expect(upsert).not.toHaveBeenCalled();
    expect(learnerUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["equal to", "FRUSTRATION_HIGH_EMERGENT", "FRUSTRATION_HIGH_EMERGENT"],
    ["below", "INSTRUCTIONAL_DEVELOPING", "FRUSTRATION_HIGH_EMERGENT"],
  ])(
    "a client level %s the DB previous level is VALIDATION_FAILED and nothing is written",
    async (_n, dbPrev, clientLevel) => {
      dbPreviousFilipino = dbPrev;
      const res = await saveMosyDecision(
        form({
          decision: "MOVE_OUT",
          reason: "IMPROVED_READING_LEVEL",
          improvedToLevel: clientLevel,
        })
      );
      expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
      expect((res as { fieldErrors?: Record<string, string> }).fieldErrors).toHaveProperty(
        "reason"
      );
      expect(readingFindFirst).toHaveBeenCalledTimes(1);
      expect(upsert).not.toHaveBeenCalled();
      expect(learnerUpdate).not.toHaveBeenCalled();
      expect(writeAudit).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    }
  );

  it("ignores a client-supplied previous level: only the DB-loaded one counts", async () => {
    dbPreviousFilipino = "INDEPENDENT_GRADE_READY"; // top: nothing to improve to
    const fd = form({
      decision: "MOVE_OUT",
      reason: "IMPROVED_READING_LEVEL",
      improvedToLevel: "INDEPENDENT_GRADE_READY",
    });
    fd.set("previousFilipinoLevel", "NON_DECODER_LOW_EMERGENT");
    const res = await saveMosyDecision(fd);
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("accepts a level above the DB previous level and persists improvedToLevel", async () => {
    dbPreviousFilipino = "FRUSTRATION_HIGH_EMERGENT";
    const res = await saveMosyDecision(
      form({
        decision: "MOVE_OUT",
        reason: "IMPROVED_READING_LEVEL",
        improvedToLevel: "INSTRUCTIONAL_DEVELOPING",
      })
    );
    expect(res).toEqual({ ok: true, data: { transition: "MOVED_OUT" } });
    const up = upsert.mock.calls[0][0];
    expect(up.create).toMatchObject({
      reason: "IMPROVED_READING_LEVEL",
      improvedToLevel: "INSTRUCTIONAL_DEVELOPING",
    });
    expect(up.update).toMatchObject({
      reason: "IMPROVED_READING_LEVEL",
      improvedToLevel: "INSTRUCTIONAL_DEVELOPING",
    });
    expect(learnerUpdate).toHaveBeenCalledTimes(1);
  });

  it("with no DB reading record the lowest level is rejected and the next accepted", async () => {
    dbPreviousFilipino = null;
    const bad = await saveMosyDecision(
      form({
        decision: "MOVE_OUT",
        reason: "IMPROVED_READING_LEVEL",
        improvedToLevel: "NON_DECODER_LOW_EMERGENT",
      })
    );
    expect(bad).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(upsert).not.toHaveBeenCalled();
    const ok = await saveMosyDecision(
      form({
        decision: "MOVE_OUT",
        reason: "IMPROVED_READING_LEVEL",
        improvedToLevel: "FRUSTRATION_HIGH_EMERGENT",
      })
    );
    expect(ok).toMatchObject({ ok: true });
  });

  it("an LSEN move out stores improvedToLevel null even if the client posts one", async () => {
    const res = await saveMosyDecision(
      form({
        decision: "MOVE_OUT",
        reason: "DIAGNOSED_LSEN",
        improvedToLevel: "INDEPENDENT_GRADE_READY",
      })
    );
    expect(res).toMatchObject({ ok: true });
    expect(upsert.mock.calls[0][0].create.improvedToLevel).toBeNull();
    expect(upsert.mock.calls[0][0].update.improvedToLevel).toBeNull();
  });

  it("STAY upsert carries improvedToLevel null", async () => {
    await saveMosyDecision(form({ decision: "STAY" }));
    expect(upsert.mock.calls[0][0].create.improvedToLevel).toBeNull();
    expect(upsert.mock.calls[0][0].update.improvedToLevel).toBeNull();
  });

  it("takes the grade from the DB learner, not the form", async () => {
    const fd = form({ decision: "STAY", mosyLevel: "CVC_BLENDING" });
    fd.set("gradeType", "KINDER");
    const res = await saveMosyDecision(fd);
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect((res as { fieldErrors?: Record<string, string> }).fieldErrors).toHaveProperty("mosyLevel");
  });

  it("takes schoolId from the session, never from the form", async () => {
    const fd = form({ decision: "STAY" });
    fd.set("schoolId", OTHER_SCHOOL);
    const res = await saveMosyDecision(fd);
    expect(res).toMatchObject({ ok: true });
    expect(upsert.mock.calls[0][0].create.schoolId).toBe(SCHOOL_ID);
  });
});

describe("saveMosyDecision — MOVE_OUT", () => {
  it("upserts the decision AND updates the learner, both on the same transaction", async () => {
    const res = await saveMosyDecision(
      form({ decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN", remarks: "  needs SPED referral " })
    );
    expect(res).toEqual({ ok: true, data: { transition: "MOVED_OUT" } });

    expect(upsert).toHaveBeenCalledTimes(1);
    expect(learnerUpdate).toHaveBeenCalledTimes(1);
    expect(txLog.map((l) => l.op)).toEqual(["upsert", "learner.update"]);
    expect(new Set(txLog.map((l) => l.tx)).size).toBe(1);

    const up = upsert.mock.calls[0][0];
    expect(up.where).toEqual({
      learnerId_schoolYearId: { learnerId: LEARNER_ID, schoolYearId: YEAR_ID },
    });
    expect(up.create).toMatchObject({
      schoolId: SCHOOL_ID,
      schoolYearId: YEAR_ID,
      learnerId: LEARNER_ID,
      decision: "MOVE_OUT",
      reason: "DIAGNOSED_LSEN",
      remarks: "needs SPED referral",
      tutorId: USER_ID,
      priorAralEnrolledAt: ENROLLED,
    });
    expect(up.update).toMatchObject({ decision: "MOVE_OUT", tutorId: USER_ID });

    expect(learnerUpdate).toHaveBeenCalledWith({
      where: { id: LEARNER_ID },
      data: { isAralLearner: false, aralTeacherId: null, aralEnrolledAt: null },
    });
  });

  it("if the learner update fails the action fails (nothing after the transaction runs)", async () => {
    learnerUpdate.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const res = await saveMosyDecision(
      form({ decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN" })
    );
    expect(res).toMatchObject({ ok: false });
    expect(writeAudit).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("writes ARAL_MOSY_MOVE_OUT and busts the membership surfaces including teacherShell", async () => {
    await saveMosyDecision(form({ decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN" }));
    expect(writeAudit).toHaveBeenCalledTimes(1);
    expect((writeAudit.mock.calls[0] as unknown[])[0]).toMatchObject({
      action: "ARAL_MOSY_MOVE_OUT",
      resource: "AralMosyDecision",
      resourceId: LEARNER_ID,
      userId: USER_ID,
      schoolId: SCHOOL_ID,
    });
    const paths = revalidatePath.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(
      expect.arrayContaining([
        ARAL_MOSY_HREF,
        "/teacher/aral",
        ARAL_PROFILING_HREF,
        "/teacher/learners",
        `/teacher/grade/${GRADE_ID}`,
        `/teacher/grade/${GRADE_ID}/learners/${LEARNER_ID}`,
      ])
    );
    expect(revalidateLearnerScoped).toHaveBeenCalledWith({
      schoolId: SCHOOL_ID,
      teacherId: ADVISER_ID,
      aralTeacherId: USER_ID,
      teacherShell: true,
    });
  });
});

describe("saveMosyDecision — re-tag", () => {
  it("STAY on a moved-out learner re-tags with the restored date and audits ARAL_MOSY_RETAG", async () => {
    learnerRow = taggedLearner({ isAralLearner: false, aralTeacherId: null, aralEnrolledAt: null });
    existingRow = { decision: "MOVE_OUT", tutorId: USER_ID, priorAralEnrolledAt: ENROLLED };
    const res = await saveMosyDecision(form({ decision: "STAY" }));
    expect(res).toEqual({ ok: true, data: { transition: "RETAGGED" } });
    expect(learnerUpdate).toHaveBeenCalledWith({
      where: { id: LEARNER_ID },
      data: { isAralLearner: true, aralTeacherId: USER_ID, aralEnrolledAt: ENROLLED },
    });
    expect(txLog.map((l) => l.op)).toEqual(["upsert", "learner.update"]);
    expect((writeAudit.mock.calls[0] as unknown[])[0]).toMatchObject({ action: "ARAL_MOSY_RETAG" });
    expect(revalidateLearnerScoped).toHaveBeenCalledWith(
      expect.objectContaining({ teacherShell: true })
    );
  });

  it("another tutor's moved-out learner is NOT_FOUND", async () => {
    learnerRow = taggedLearner({ isAralLearner: false, aralTeacherId: null, aralEnrolledAt: null });
    existingRow = { decision: "MOVE_OUT", tutorId: OTHER_TUTOR, priorAralEnrolledAt: ENROLLED };
    const res = await saveMosyDecision(form({ decision: "STAY" }));
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(learnerUpdate).not.toHaveBeenCalled();
  });
});

describe("saveMosyDecision — level-only saves", () => {
  it.each([
    ["deferred (decision empty)", { decision: "" }],
    ["STAY", { decision: "STAY" }],
  ])("%s never calls learner.update and only revalidates the MOSY page", async (_n, fields) => {
    const res = await saveMosyDecision(form({ ...fields, mosyLevel: "INDEPENDENT_GRADE_READY" }));
    expect(res).toEqual({ ok: true, data: { transition: "NONE" } });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(learnerUpdate).not.toHaveBeenCalled();
    expect(revalidatePath.mock.calls.map((c) => c[0])).toEqual([ARAL_MOSY_HREF]);
    expect(revalidateLearnerScoped).not.toHaveBeenCalled();
    expect((writeAudit.mock.calls[0] as unknown[])[0]).toMatchObject({ action: "ARAL_MOSY_SAVE" });
  });

  it("omitting the decision field entirely is a deferred save, not an untag", async () => {
    const res = await saveMosyDecision(form({}));
    expect(res).toEqual({ ok: true, data: { transition: "NONE" } });
    expect(learnerUpdate).not.toHaveBeenCalled();
  });

  it("clearing a decision after one exists is rejected and writes nothing", async () => {
    existingRow = { decision: "STAY", tutorId: USER_ID, priorAralEnrolledAt: null };
    const res = await saveMosyDecision(form({ decision: "" }));
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect((res as { fieldErrors?: Record<string, string> }).fieldErrors).toHaveProperty("decision");
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe("saveMosyDecision — audit metadata", () => {
  it.each([
    ["MOVE_OUT", { decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN", remarks: "Ana Cruz has epilepsy" }],
    [
      "MOVE_OUT improved",
      {
        decision: "MOVE_OUT",
        reason: "IMPROVED_READING_LEVEL",
        improvedToLevel: "INDEPENDENT_GRADE_READY",
        remarks: "Ana Cruz has epilepsy",
      },
    ],
    ["STAY", { decision: "STAY", remarks: "Ana Cruz has epilepsy" }],
    ["deferred", { decision: "", remarks: "Ana Cruz has epilepsy" }],
  ])("%s carries ids and codes only, never remarks", async (_n, fields) => {
    const res = await saveMosyDecision(form(fields));
    expect(res).toMatchObject({ ok: true });
    const call = (writeAudit.mock.calls[0] as unknown[])[0] as { metadata: Record<string, unknown> };
    expect(call.metadata).not.toHaveProperty("remarks");
    expect(JSON.stringify(call)).not.toContain("Ana Cruz");
    expect(Object.keys(call.metadata).sort()).toEqual(
      [
        "decision",
        "improvedToLevel",
        "learnerId",
        "mosyLevel",
        "reason",
        "schoolId",
        "schoolYearId",
      ].sort()
    );
    expect(call.metadata).toMatchObject({
      schoolId: SCHOOL_ID,
      learnerId: LEARNER_ID,
      schoolYearId: YEAR_ID,
    });
  });

  it("audit metadata records improvedToLevel for an improvement and null otherwise", async () => {
    await saveMosyDecision(
      form({
        decision: "MOVE_OUT",
        reason: "IMPROVED_READING_LEVEL",
        improvedToLevel: "INDEPENDENT_GRADE_READY",
      })
    );
    await saveMosyDecision(form({ decision: "STAY" }));
    const metas = writeAudit.mock.calls.map(
      (c) => ((c as unknown[])[0] as { metadata: Record<string, unknown> }).metadata
    );
    expect(metas[0]).toMatchObject({
      reason: "IMPROVED_READING_LEVEL",
      improvedToLevel: "INDEPENDENT_GRADE_READY",
    });
    expect(metas[1]).toMatchObject({ reason: null, improvedToLevel: null });
  });

  it("each transition writes its own audit action, exactly one row per save", async () => {
    await saveMosyDecision(form({ decision: "STAY" }));
    await saveMosyDecision(form({ decision: "MOVE_OUT", reason: "DIAGNOSED_LSEN" }));
    const actions = writeAudit.mock.calls.map((c) => (c as unknown[])[0] as { action: string }).map((c) => c.action);
    expect(actions).toEqual(["ARAL_MOSY_SAVE", "ARAL_MOSY_MOVE_OUT"]);
  });
});
