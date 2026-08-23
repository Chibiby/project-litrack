import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { getTermWindows, isTermLocked } from "@/lib/terms/windows";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

/**
 * Action-level coverage for `saveTermGrades` — the only write behind the End of
 * Terms grade sheet.
 *
 * The design (`docs/superpowers/specs/2026-08-22-end-of-terms-reports-design.md`
 * §4, §9) lists five refusals, and every one of them is enforced here and nowhere
 * else: the grid disables its inputs and hides its Save button, but a client is
 * not an enforcement point. What is contract, and so asserted rather than
 * assumed:
 *
 *   - The roster is read through `schoolId` AND the adviser's own section, so a
 *     learner from another tenant or another section cannot be graded by id. A
 *     partial match fails the WHOLE batch with one generic message — that is what
 *     stops a probe from telling "another school's" apart from "not my section",
 *     and what stops the valid half of a poisoned batch from being written.
 *   - Every placement fact is re-derived server-side. The posted `gradeLevelId` is
 *     checked against the advisory, never trusted.
 *   - A locked term, a missing school year, a non-adviser and a Super Admin all
 *     refuse before any write.
 *   - Scores never reach `AuditLog`. They are learner PII (`docs/privacy.md`); the
 *     row carries placement, counts and learner ids only.
 *
 * Only leaf infrastructure is mocked (Prisma client, session, audit, cache). The
 * real Zod schema, the real `getAdvisoryPlacement`, the real `deniesAdvisoryRoster`
 * and the real term-window maths all run, so the `where` clauses these tests
 * inspect are the ones the action would send to Postgres.
 */

const TEACHER_ID = "teacher-marivic";
const SCHOOL_ID = "school-malandag";
const OTHER_SCHOOL_ID = "school-kiblawan";
const SECTION_ID = "section-sampaguita";
const OTHER_SECTION_ID = "section-rosal";
const GRADE_ID = "grade-g7";
const OTHER_GRADE_ID = "grade-g8";
const SCHOOL_YEAR_ID = "sy-2026-2027";

/**
 * The fake clock. December 15 2026 at LOCAL noon — built from local fields, never
 * a UTC instant, and deliberately mid-month: this box is UTC+8 and CI is UTC, and
 * both must resolve `schoolToday()` to the same civil day or the set of locked
 * terms changes between the two.
 *
 * With an August-start school year that puts First Term (Aug-Oct) six weeks shut
 * and Second Term (Nov-Jan) six weeks open, so one instant exercises both sides of
 * the lock. The distance from either boundary is what makes it robust.
 */
const TODAY = new Date(2026, 11, 15, 12, 0, 0);
/** August 1 2026 — the approved sheet's calendar. Local midnight, no UTC instant. */
const SCHOOL_YEAR_START = new Date(2026, 7, 1);
/** Open on `TODAY`. The term every non-lock test posts. */
const OPEN_TERM = "SECOND";
/** Closed on `TODAY`. */
const LOCKED_TERM = "FIRST";

type LearnerRow = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  sectionId: string | null;
  deletedAt: Date | null;
  archivedAt: Date | null;
};

type SectionRow = {
  id: string;
  name: string;
  schoolId: string;
  gradeLevelId: string;
  gradeType: string;
  deletedAt: Date | null;
};

type SchoolYearRow = {
  id: string;
  schoolId: string;
  isActive: boolean;
  startDate: Date;
};

/** The school's learner table for one test. */
let learners: LearnerRow[];
let sections: SectionRow[];
let schoolYears: SchoolYearRow[];
/** `TeacherProfile.designation` for the caller; `null` is an ordinary DepEd teacher. */
let designation: string | null;
/** What `requireSchoolUser` resolves. Mutated per test, never widened by default. */
let session: {
  id: string;
  schoolId: string;
  role: "TEACHER" | "SUPER_ADMIN";
  advisorySectionId: string | null;
};

/** Every `where` the action read the roster with, for the mechanism assertions. */
let learnerFindManyArgs: { where: Record<string, unknown> }[];

function learner(overrides: Partial<LearnerRow> & { id: string }): LearnerRow {
  return {
    schoolId: SCHOOL_ID,
    gradeLevelId: GRADE_ID,
    sectionId: SECTION_ID,
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

/**
 * Honours exactly the clauses the action supplies and no more.
 *
 * This is the load-bearing property of the fake: if the action ever drops
 * `schoolId` or `sectionId` from the roster `where`, the foreign rows below stop
 * being filtered here too, the counts agree, and the cross-tenant tests go red —
 * which is the direction a fake must fail in. A fake that hardcoded the filters
 * would keep passing after the real ones were deleted.
 */
function learnerMatches(row: LearnerRow, where: Record<string, unknown>): boolean {
  const ids = (where.id as { in: string[] } | undefined)?.in ?? [];
  if (!ids.includes(row.id)) return false;
  if ("schoolId" in where && row.schoolId !== where.schoolId) return false;
  if ("gradeLevelId" in where && row.gradeLevelId !== where.gradeLevelId) return false;
  if ("sectionId" in where && row.sectionId !== where.sectionId) return false;
  if (where.deletedAt === null && row.deletedAt !== null) return false;
  if (where.archivedAt === null && row.archivedAt !== null) return false;
  return true;
}

const learnerFindMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
  learnerFindManyArgs.push(args);
  return learners
    .filter((l) => learnerMatches(l, args.where))
    .map((l) => ({ id: l.id }));
});

/** Backs the real `getAdvisoryPlacement`, tenant filter and soft delete included. */
const sectionFindFirst = vi.fn(
  async (args: { where: { id: string; schoolId: string; deletedAt: null } }) => {
    const found = sections.find(
      (s) =>
        s.id === args.where.id &&
        s.schoolId === args.where.schoolId &&
        (args.where.deletedAt !== null || s.deletedAt === null)
    );
    if (!found) return null;
    return {
      id: found.id,
      name: found.name,
      gradeLevelId: found.gradeLevelId,
      gradeLevel: { type: found.gradeType },
    };
  }
);

/** `TeacherProfile` carries no `schoolId`, so the tenant rides the user relation. */
const teacherProfileFindFirst = vi.fn(
  async (args: { where: { userId: string; user: { schoolId: string } } }) => {
    if (args.where.userId !== session.id) return null;
    if (args.where.user?.schoolId !== session.schoolId) return null;
    return { designation };
  }
);

const schoolYearFindFirst = vi.fn(
  async (args: { where: { schoolId: string; isActive: boolean } }) => {
    const found = schoolYears.find(
      (y) => y.schoolId === args.where.schoolId && y.isActive === args.where.isActive
    );
    return found ? { id: found.id, startDate: found.startDate } : null;
  }
);

/**
 * The write surface.
 *
 * Encoded cells are no longer written through `prisma.termGrade.upsert`. They go
 * out as ONE multi-row `INSERT … ON CONFLICT DO UPDATE` per chunk, issued with
 * `tx.$queryRaw`, because a per-row upsert loop could not finish a full sheet
 * inside a transaction timeout. So "wrote nothing" now means: the raw statement
 * was never issued, `deleteMany` was never called, and the transaction never
 * opened. Asserting on `upsert` would be asserting on a builder the action no
 * longer has — a dead assertion that reads as coverage.
 *
 * `queryRaw` below is not a stub. It models the tenant JOIN in the real
 * statement: a row comes back only if the learner it names satisfies the school,
 * grade and section ids THAT WERE ACTUALLY BOUND into the SQL. That is what makes
 * this fake fail in the right direction — delete `l."schoolId" = $n` from the
 * action and `SCHOOL_ID` stops being bound, no rows come back, the action's own
 * `RETURNING` count check throws, and the happy path goes red. Once the Prisma
 * `where` object is gone, the bound-parameter list is the only witness that a
 * tenant predicate held.
 */
type RawCall = { sql: string; params: unknown[] };
let rawWrites: RawCall[];

/** Prisma nests `Prisma.sql`/`Prisma.join` fragments; bound params are the leaves. */
function flattenBoundParams(values: readonly unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const v of values) {
    const nested = (v as { values?: unknown[] } | null)?.values;
    if (v && typeof v === "object" && Array.isArray(nested)) {
      out.push(...flattenBoundParams(nested));
    } else {
      out.push(v);
    }
  }
  return out;
}

const queryRaw = vi.fn(
  async (strings: readonly string[], ...values: unknown[]) => {
    const params = flattenBoundParams(values);
    rawWrites.push({ sql: strings.join(" ? "), params });

    // One returned row per (learner, subject) pair whose learner clears the bound
    // predicate. `deletedAt`/`archivedAt IS NULL` are literal SQL rather than
    // binds, so they are read off the row directly.
    return params
      .filter(
        (p): p is string =>
          typeof p === "string" && learners.some((l) => l.id === p)
      )
      .filter((id) => {
        const row = learners.find((l) => l.id === id)!;
        return (
          params.includes(row.schoolId) &&
          params.includes(row.gradeLevelId) &&
          (row.sectionId === null || params.includes(row.sectionId)) &&
          row.deletedAt === null &&
          row.archivedAt === null
        );
      })
      .map((id) => ({ id: `termgrade-${id}` }));
  }
);

const termGradeDeleteMany = vi.fn(async (args: unknown) => ({ count: 1, args }));

/**
 * The save path is an INTERACTIVE transaction now (the raw statement has to be
 * awaited, and the delete has to be ordered before it), so the callback is run
 * against a `tx` client wired to the same mocks.
 */
const transaction = vi.fn(async (arg: unknown, _options?: unknown) => {
  if (typeof arg === "function") {
    return (arg as (tx: unknown) => unknown)({
      $queryRaw: (...a: unknown[]) => queryRaw(...(a as [never])),
      termGrade: {
        deleteMany: (...a: unknown[]) => termGradeDeleteMany(...(a as [never])),
      },
    });
  }
  return arg;
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    learner: {
      findMany: (...args: unknown[]) => learnerFindMany(...(args as [never])),
    },
    section: {
      findFirst: (...args: unknown[]) => sectionFindFirst(...(args as [never])),
    },
    teacherProfile: {
      findFirst: (...args: unknown[]) => teacherProfileFindFirst(...(args as [never])),
    },
    schoolYear: {
      findFirst: (...args: unknown[]) => schoolYearFindFirst(...(args as [never])),
    },
  },
}));

const requireSchoolUser = vi.fn(async () => session);
const requireUser = vi.fn(async () => session);
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...(args as [])),
  requireUser: (...args: unknown[]) => requireUser(...(args as [])),
}));

/** Typed so the audit row can be read back off `.mock.calls` without a cast. */
const writeAudit = vi.fn(
  async (_entry: {
    action: string;
    resource: string;
    resourceId: string | null;
    metadata: Record<string, unknown>;
  }) => {}
);
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [never])),
  AUDIT_ACTIONS: {
    TERM_GRADES_BULK_SAVE: "TERM_GRADES_BULK_SAVE",
    TERM_GRADES_EXPORT: "TERM_GRADES_EXPORT",
  },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...(args as [])),
}));

const revalidateLearnerScoped = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: (...args: unknown[]) =>
    revalidateLearnerScoped(...(args as [])),
}));

// Imported after the mock factories above are registered.
const { saveTermGrades } = await import("@/lib/actions/term-grades");

/**
 * Every write path the action can take, for the "wrote nothing" assertions.
 *
 * `queryRaw` replaced `termGrade.upsert` here when the save became set-based. The
 * old `upsert` assertion is deliberately GONE rather than left behind: the action
 * cannot call that builder any more, so it could never fail again, and 20 refusal
 * tests would have kept passing while the action wrote every row.
 */
function expectNoWrites() {
  expect(queryRaw).not.toHaveBeenCalled();
  expect(rawWrites).toHaveLength(0);
  expect(termGradeDeleteMany).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
  expect(revalidateLearnerScoped).not.toHaveBeenCalled();
}

/** A2-2: the bound-parameter list is the only tenancy witness a raw write has. */
function expectNoForeignParamsBound(secrets: string[]) {
  const serialized = JSON.stringify(rawWrites);
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
}

type Entry = { learnerId: string; subject: string; score: number | null };

function post(overrides: {
  gradeLevelId?: string;
  term?: string;
  entries?: Entry[];
} = {}) {
  return saveTermGrades({
    gradeLevelId: GRADE_ID,
    term: OPEN_TERM,
    entries: [{ learnerId: "learner-a", subject: "ENGLISH", score: 87 }],
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(TODAY);

  learners = [learner({ id: "learner-a" }), learner({ id: "learner-b" })];
  sections = [
    {
      id: SECTION_ID,
      name: "Sampaguita",
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      gradeType: "G7",
      deletedAt: null,
    },
  ];
  schoolYears = [
    {
      id: SCHOOL_YEAR_ID,
      schoolId: SCHOOL_ID,
      isActive: true,
      startDate: SCHOOL_YEAR_START,
    },
  ];
  designation = null;
  session = {
    id: TEACHER_ID,
    schoolId: SCHOOL_ID,
    role: "TEACHER",
    advisorySectionId: SECTION_ID,
  };
  learnerFindManyArgs = [];
  rawWrites = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("saveTermGrades — the fixture clock", () => {
  it("puts one term shut and one term open on the same day", () => {
    // Guards every other case in this file. If `schoolToday()` ever resolves to a
    // different civil day here than it does in CI, the lock assertions below
    // would flip silently — so the assumption is stated once, loudly, instead of
    // being spread implicitly across a dozen tests.
    const todayKey = formatLocalDateKey(schoolToday());
    expect(todayKey).toBe("2026-12-15");

    const [first, second, third] = getTermWindows(SCHOOL_YEAR_START);
    expect(first.term).toBe(LOCKED_TERM);
    expect(second.term).toBe(OPEN_TERM);
    expect(isTermLocked(first, todayKey)).toBe(true);
    expect(isTermLocked(second, todayKey)).toBe(false);
    expect(isTermLocked(third, todayKey)).toBe(false);
  });
});

describe("saveTermGrades — the happy path this file's refusals are measured against", () => {
  it("upserts encoded cells, deletes cleared ones, and logs no scores", async () => {
    // The control. Without it every refusal below could be passing for the wrong
    // reason — a harness that can never reach the write makes "wrote nothing"
    // vacuously true.
    const res = await post({
      entries: [
        { learnerId: "learner-a", subject: "ENGLISH", score: 87 },
        { learnerId: "learner-b", subject: "MATHEMATICS", score: 93 },
        { learnerId: "learner-b", subject: "SCIENCE", score: null },
      ],
    });

    expect(res).toEqual({ ok: true, data: { saved: 2, cleared: 1 } });
    expect(requireSchoolUser).toHaveBeenCalledWith("TEACHER");
    expect(transaction).toHaveBeenCalledTimes(1);
    // ONE statement for both encoded cells, not one per cell.
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(rawWrites).toHaveLength(1);

    // A cleared cell is a DELETED row, not a null write: `TermGrade.score` is a
    // non-nullable Int, so absence of a row is the only "not encoded".
    expect(termGradeDeleteMany).toHaveBeenCalledTimes(1);
    expect(termGradeDeleteMany.mock.calls[0][0]).toEqual({
      where: {
        schoolYearId: SCHOOL_YEAR_ID,
        term: OPEN_TERM,
        OR: [{ learnerId: "learner-b", subject: "SCIENCE" }],
      },
    });

    const { sql, params } = rawWrites[0];
    // The conflict target IS the unique constraint, and `updatedAt` is bumped in
    // the DO UPDATE branch. Prisma's `@updatedAt` is client-side and there is no
    // database trigger, so omitting that clause would freeze the column at
    // first-insert time forever — silently, with nothing to fail.
    expect(sql).toContain(
      'ON CONFLICT ("learnerId", "schoolYearId", "term", "subject") DO UPDATE'
    );
    expect(sql).toContain('"updatedAt" = EXCLUDED."updatedAt"');
    // The school year is part of the key: a term enum carries no year, so without
    // it next year's Second Term English would collide with this one.
    expect(params).toContain(SCHOOL_YEAR_ID);
    // Tenancy: the predicate is bound, not interpolated, and it is the tenant.
    expect(sql).toContain('l."schoolId" =');
    expect(sql).toContain('l."deletedAt" IS NULL');
    expect(params).toContain(SCHOOL_ID);
    expect(params).toContain(SECTION_ID);
    for (const id of ["learner-a", "learner-b"]) {
      expect(params).toContain(id);
    }
    // Scores are bound values, and `recordedById` is the caller — never a client
    // -supplied id.
    expect(params).toContain(87);
    expect(params).toContain(93);
    expect(params).toContain(TEACHER_ID);

    // Placement, counts and learner ids — and an EXACT shape, because that is the
    // only assertion a newly added `scores` key cannot slip past.
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.action).toBe("TERM_GRADES_BULK_SAVE");
    expect(audit.resource).toBe("TermGrade");
    expect(audit.metadata).toEqual({
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      sectionId: SECTION_ID,
      term: OPEN_TERM,
      schoolYearId: SCHOOL_YEAR_ID,
      saved: 2,
      cleared: 1,
      learnerIds: ["learner-a", "learner-b"],
    });
    // Belt and braces on the PII rule: the scores are distinctive two-digit
    // numbers that cannot collide with any count in the row above.
    const serialized = JSON.stringify(audit.metadata);
    for (const score of ["87", "93"]) {
      expect(serialized).not.toContain(score);
    }

    expect(revalidatePath).toHaveBeenCalledWith(
      `/teacher/aral/${GRADE_ID}/terms-reports`
    );
    expect(revalidateLearnerScoped).toHaveBeenCalledWith({
      schoolId: SCHOOL_ID,
      teacherId: TEACHER_ID,
    });
  });

  it("reads the roster through the school AND the advisory section", async () => {
    await post();

    expect(learnerFindManyArgs).toHaveLength(1);
    // The mechanism the two isolation tests below depend on. Asserted directly so
    // a deleted clause fails here as well as through its consequences.
    expect(learnerFindManyArgs[0].where).toEqual({
      id: { in: ["learner-a"] },
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      sectionId: SECTION_ID,
      deletedAt: null,
      archivedAt: null,
    });
  });
});

describe("saveTermGrades — refusal 1: a locked term", () => {
  it("refuses a term whose months have passed", async () => {
    // The grid disables its inputs once a term closes; a stale tab does not. This
    // is the only enforcement point.
    const res = await post({ term: LOCKED_TERM });

    expect(res.ok).toBe(false);
    expect(res).toMatchObject({
      error: expect.stringContaining("First Term is closed"),
    });
    expectNoWrites();
    // Refused before the roster was even read.
    expect(learnerFindMany).not.toHaveBeenCalled();
  });

  it("still accepts a term that has not started yet", async () => {
    // "Not yet begun" is not "closed" — a teacher may encode ahead, and treating
    // a future window as locked would shut the sheet for two thirds of the year.
    const res = await post({ term: "THIRD" });
    expect(res).toEqual({ ok: true, data: { saved: 1, cleared: 0 } });
  });

  it("rejects a term string that names no window", async () => {
    // Zod catches it first, which is the point: an unrecognised term must never
    // reach `resolveTermWindow` and be treated as unlocked.
    const res = await post({ term: "FOURTH" });
    expect(res.ok).toBe(false);
    expectNoWrites();
    expect(learnerFindMany).not.toHaveBeenCalled();
  });
});

describe("saveTermGrades — refusal 2: a learner outside the advisory section", () => {
  it("refuses a real learner in another section of the same grade", async () => {
    learners.push(learner({ id: "learner-other-section", sectionId: OTHER_SECTION_ID }));

    const res = await post({
      entries: [
        { learnerId: "learner-other-section", subject: "ENGLISH", score: 87 },
      ],
    });

    expect(res).toEqual({
      ok: false,
      error: "One or more learners are not in your advisory section",
    });
    expectNoWrites();
  });

  it("refuses a learner in another grade of the same school", async () => {
    learners.push(
      learner({ id: "learner-other-grade", gradeLevelId: OTHER_GRADE_ID })
    );

    const res = await post({
      entries: [{ learnerId: "learner-other-grade", subject: "ENGLISH", score: 87 }],
    });

    expect(res.ok).toBe(false);
    expectNoWrites();
  });

  it("refuses an archived or soft-deleted learner in its own section", async () => {
    learners.push(
      learner({ id: "learner-archived", archivedAt: new Date(2026, 9, 1) }),
      learner({ id: "learner-deleted", deletedAt: new Date(2026, 9, 1) })
    );

    for (const id of ["learner-archived", "learner-deleted"]) {
      vi.clearAllMocks();
      const res = await post({
        entries: [{ learnerId: id, subject: "ENGLISH", score: 87 }],
      });
      expect(res.ok).toBe(false);
      expectNoWrites();
    }
  });

  it("writes NOTHING for the valid half of a mixed batch", async () => {
    // The mechanism, not the boolean. The action compares the scoped `findMany`
    // count against the requested count and refuses the whole batch, so one good
    // learner beside one it may not touch must save ZERO rows. A test that only
    // checked `ok === false` would pass while the good half leaked through.
    learners.push(learner({ id: "learner-other-section", sectionId: OTHER_SECTION_ID }));

    const res = await post({
      entries: [
        { learnerId: "learner-a", subject: "ENGLISH", score: 87 },
        { learnerId: "learner-other-section", subject: "ENGLISH", score: 93 },
      ],
    });

    expect(res.ok).toBe(false);
    expectNoWrites();
  });
});

describe("saveTermGrades — refusal 3: a cross-tenant learner id", () => {
  /**
   * Same grade id, same section id, different school. Contrived on purpose: it
   * leaves `schoolId` as the ONLY clause that can exclude the row, so this case
   * fails the moment tenancy stops being in the roster `where`. `TermGrade` carries
   * no `schoolId` column of its own (matching `ReadingLevelRecord`), so this query
   * is the whole of the tenant boundary for this feature.
   */
  const foreign = () =>
    learner({
      id: "learner-other-school",
      schoolId: OTHER_SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      sectionId: SECTION_ID,
    });

  it("refuses a learner belonging to another school", async () => {
    learners.push(foreign());

    const res = await post({
      entries: [{ learnerId: "learner-other-school", subject: "ENGLISH", score: 87 }],
    });

    expect(res.ok).toBe(false);
    expectNoWrites();
  });

  it("answers identically to a same-school, wrong-section learner", async () => {
    // Indistinguishable from the caller's side, or the error itself becomes an
    // existence oracle: "that learner is real but elsewhere" is exactly what a
    // prober is fishing for.
    learners.push(foreign(), learner({ id: "learner-near", sectionId: OTHER_SECTION_ID }));

    const crossTenant = await post({
      entries: [{ learnerId: "learner-other-school", subject: "ENGLISH", score: 87 }],
    });
    vi.clearAllMocks();
    const crossSection = await post({
      entries: [{ learnerId: "learner-near", subject: "ENGLISH", score: 87 }],
    });
    vi.clearAllMocks();
    const nonexistent = await post({
      entries: [{ learnerId: "learner-does-not-exist", subject: "ENGLISH", score: 87 }],
    });

    expect(crossTenant).toEqual(crossSection);
    expect(crossTenant).toEqual(nonexistent);
    // And the message names nothing: no school, no section, no learner id.
    const serialized = JSON.stringify(crossTenant);
    for (const secret of [OTHER_SCHOOL_ID, OTHER_SECTION_ID, "learner-other-school"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("never binds a foreign id into the write statement", async () => {
    // A2-2 applied to the write path. Written against `rawWrites` rather than
    // against the absence of a call, so it keeps its meaning if the action is ever
    // changed to build its SQL before the roster check.
    learners.push(foreign());

    await post({
      entries: [
        { learnerId: "learner-a", subject: "ENGLISH", score: 87 },
        { learnerId: "learner-other-school", subject: "MATHEMATICS", score: 93 },
      ],
    });

    expectNoForeignParamsBound([
      OTHER_SCHOOL_ID,
      OTHER_SECTION_ID,
      "learner-other-school",
    ]);
  });

  it("binds only this tenant's ids on a save that really happens", async () => {
    // The other half of the property, and the reason the test above cannot pass
    // vacuously: here the statement IS issued, and it still carries no foreign id.
    learners.push(foreign(), learner({ id: "learner-near", sectionId: OTHER_SECTION_ID }));

    const res = await post({
      entries: [{ learnerId: "learner-a", subject: "ENGLISH", score: 87 }],
    });

    expect(res.ok).toBe(true);
    expect(rawWrites).toHaveLength(1);
    expectNoForeignParamsBound([
      OTHER_SCHOOL_ID,
      OTHER_SECTION_ID,
      "learner-other-school",
      "learner-near",
    ]);
  });

  it("writes NOTHING for the valid half of a cross-tenant batch", async () => {
    // The worst shippable bug in this repo would be a partial commit here: one of
    // this teacher's own learners saved, the foreign id merely skipped, and no
    // indication in the response that half the sheet went nowhere.
    learners.push(foreign());

    const res = await post({
      entries: [
        { learnerId: "learner-a", subject: "ENGLISH", score: 87 },
        { learnerId: "learner-other-school", subject: "MATHEMATICS", score: 93 },
      ],
    });

    expect(res.ok).toBe(false);
    expectNoWrites();
  });
});

describe("saveTermGrades — refusal 4: no active school year", () => {
  it("refuses when the school has no active year", async () => {
    // A real state the schema permits — learner creation already skips enrolment
    // when there is none — so the answer is a refusal, not orphaned rows keyed to
    // a year that does not exist.
    schoolYears = [];

    const res = await post();

    expect(res).toMatchObject({ ok: false });
    expect((res as { error: string }).error).toContain("No school year is active");
    expectNoWrites();
    expect(learnerFindMany).not.toHaveBeenCalled();
  });

  it("does not borrow another school's active year", async () => {
    schoolYears = [
      {
        id: "sy-other-school",
        schoolId: OTHER_SCHOOL_ID,
        isActive: true,
        startDate: SCHOOL_YEAR_START,
      },
    ];

    const res = await post();

    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("sy-other-school");
    expectNoWrites();
  });

  it("ignores an inactive year belonging to its own school", async () => {
    schoolYears = [
      {
        id: SCHOOL_YEAR_ID,
        schoolId: SCHOOL_ID,
        isActive: false,
        startDate: SCHOOL_YEAR_START,
      },
    ];

    const res = await post();
    expect(res.ok).toBe(false);
    expectNoWrites();
  });
});

describe("saveTermGrades — refusal 5: a caller who advises nothing", () => {
  it("refuses a teacher with no advisory placement", async () => {
    session.advisorySectionId = null;

    const res = await post();

    expect(res).toEqual({
      ok: false,
      error:
        "You have no advisory section yet. Ask your School Head to assign you one before adding learners.",
    });
    expectNoWrites();
    expect(learnerFindMany).not.toHaveBeenCalled();
  });

  it("refuses a teacher whose advisory section was soft-deleted", async () => {
    // The session pointer is not enough: a School Head can delete the section
    // afterwards, and grading into it would write rows no roster page lists.
    sections = sections.map((s) => ({ ...s, deletedAt: new Date(2026, 10, 1) }));

    const res = await post();
    expect(res.ok).toBe(false);
    expectNoWrites();
  });

  it("refuses a teacher whose advisory section is in another school", async () => {
    sections = sections.map((s) => ({ ...s, schoolId: OTHER_SCHOOL_ID }));

    const res = await post();
    expect(res.ok).toBe(false);
    expectNoWrites();
  });

  it("refuses a Non-DepEd ARAL volunteer", async () => {
    designation = ARAL_VOLUNTEER_DESIGNATION;

    const res = await post();

    expect(res).toEqual({
      ok: false,
      error: "End of Terms Reports is for DepEd teachers who advise a section.",
    });
    expectNoWrites();
  });

  it("refuses a volunteer even when they somehow hold an advisory section", async () => {
    // The designation gate runs BEFORE the placement lookup, so it cannot be
    // routed around by data drift — a volunteer with a section assigned by mistake
    // is still refused, and the sidebar's inert row agrees with this refusal.
    designation = ARAL_VOLUNTEER_DESIGNATION;
    session.advisorySectionId = SECTION_ID;

    const res = await post();

    expect(res).toMatchObject({
      error: "End of Terms Reports is for DepEd teachers who advise a section.",
    });
    expect(sectionFindFirst).not.toHaveBeenCalled();
    expectNoWrites();
  });
});

describe("saveTermGrades — the two that cost nothing extra", () => {
  it("refuses a Super Admin outright", async () => {
    // `requireSchoolUser("TEACHER")` passes a Super Admin by impersonation and
    // only checks that `schoolId` is non-null, so an admin row that carries one
    // reaches this action as a teacher. Their view of the sheet is read-only, and
    // the action says so explicitly rather than trusting the role check.
    session.role = "SUPER_ADMIN";

    const res = await post();

    expect(res).toEqual({ ok: false, error: "Admin view is read-only" });
    expectNoWrites();
    // Refused before any placement or roster read.
    expect(teacherProfileFindFirst).not.toHaveBeenCalled();
    expect(learnerFindMany).not.toHaveBeenCalled();
  });

  it("refuses a posted gradeLevelId that is not the caller's own", async () => {
    // A client-posted grade is never trusted: the picker is disabled, but a stale
    // tab still posts the grade it was showing.
    const res = await post({ gradeLevelId: OTHER_GRADE_ID });

    expect(res).toEqual({
      ok: false,
      error: "You are not assigned to this grade level",
    });
    expectNoWrites();
    expect(learnerFindMany).not.toHaveBeenCalled();
  });

  it("rejects a score outside 60-100, and a non-integer, before reading anything", async () => {
    for (const score of [59, 101, 87.5]) {
      vi.clearAllMocks();
      const res = await post({
        entries: [{ learnerId: "learner-a", subject: "ENGLISH", score }],
      });
      expect(res.ok).toBe(false);
      expectNoWrites();
      expect(learnerFindMany).not.toHaveBeenCalled();
    }
  });

  it("counts a repeated learner id once when checking the roster", async () => {
    // Deduped before the length comparison, or the count check would reject a
    // learner who legitimately has eight subjects on one sheet.
    const res = await post({
      entries: [
        { learnerId: "learner-a", subject: "ENGLISH", score: 87 },
        { learnerId: "learner-a", subject: "FILIPINO", score: 93 },
        { learnerId: "learner-a", subject: "MATHEMATICS", score: 99 },
      ],
    });

    expect(res).toEqual({ ok: true, data: { saved: 3, cleared: 0 } });
    expect(learnerFindManyArgs[0].where.id).toEqual({ in: ["learner-a"] });
  });
});

describe("saveTermGrades — the set-based write", () => {
  it("dedupes a repeated conflict tuple instead of hitting Postgres 21000", async () => {
    // The serial array form made a duplicated cell a harmless last-write-wins. One
    // multi-row `ON CONFLICT DO UPDATE` raises 21000 ("cannot affect row a second
    // time") and aborts the WHOLE save, so the tuple must be deduped before the
    // statement is built. Last one wins.
    const res = await post({
      entries: [
        { learnerId: "learner-a", subject: "ENGLISH", score: 87 },
        { learnerId: "learner-a", subject: "ENGLISH", score: 93 },
      ],
    });

    expect(res).toEqual({ ok: true, data: { saved: 1, cleared: 0 } });
    expect(rawWrites).toHaveLength(1);
    // The superseded score never reaches the database.
    expect(rawWrites[0].params).toContain(93);
    expect(rawWrites[0].params).not.toContain(87);
  });

  it("dedupes a repeated cleared tuple too", async () => {
    const res = await post({
      entries: [
        { learnerId: "learner-a", subject: "ENGLISH", score: null },
        { learnerId: "learner-a", subject: "ENGLISH", score: null },
      ],
    });

    expect(res).toEqual({ ok: true, data: { saved: 0, cleared: 1 } });
    expect(termGradeDeleteMany.mock.calls[0][0]).toEqual({
      where: {
        schoolYearId: SCHOOL_YEAR_ID,
        term: OPEN_TERM,
        OR: [{ learnerId: "learner-a", subject: "ENGLISH" }],
      },
    });
    // Nothing encoded, so no INSERT is issued at all.
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("lets an encoded score win over a clear of the same tuple", async () => {
    // The documented precedence rule, preserved through the rewrite: deletions are
    // ordered BEFORE the insert, and the two sides are deduped separately. Deduping
    // across the combined array would invert this.
    const res = await post({
      entries: [
        { learnerId: "learner-a", subject: "ENGLISH", score: null },
        { learnerId: "learner-a", subject: "ENGLISH", score: 87 },
      ],
    });

    expect(res).toEqual({ ok: true, data: { saved: 1, cleared: 1 } });
    expect(termGradeDeleteMany).toHaveBeenCalledTimes(1);
    expect(rawWrites[0].params).toContain(87);
  });

  it("accepts a full sheet — 100 learners x 8 subjects — in one transaction", async () => {
    // The payload the cap is sized for. It must be ACCEPTED, and it must not
    // degenerate back into a statement per cell.
    learners = Array.from({ length: 100 }, (_, i) =>
      learner({ id: `learner-${i}` })
    );
    const subjects = [
      "ENGLISH",
      "FILIPINO",
      "MATHEMATICS",
      "SCIENCE",
      "ARALING_PANLIPUNAN",
      "EDUKASYON_SA_PAGPAPAKATAO",
      "MAPEH",
      "TLE",
    ];
    const entries = learners.flatMap((l) =>
      subjects.map((subject) => ({ learnerId: l.id, subject, score: 87 }))
    );
    expect(entries).toHaveLength(800);

    const res = await post({ entries });

    expect(res).toEqual({ ok: true, data: { saved: 800, cleared: 0 } });
    expect(transaction).toHaveBeenCalledTimes(1);
    // 800 rows at the 100-row chunk size: 8 statements, not 800.
    expect(queryRaw).toHaveBeenCalledTimes(8);
  });

  it("passes an explicit timeout and maxWait rather than inheriting 5 s / 2 s", async () => {
    // The whole point of the task: the default 5 s budget cannot carry a full
    // sheet across a 220 ms link.
    await post();

    const options = transaction.mock.calls[0][1] as {
      timeout: number;
      maxWait: number;
    };
    expect(options.timeout).toBeGreaterThan(5_000);
    expect(options.maxWait).toBeGreaterThan(2_000);
  });

  it("rejects more than 1000 entries with the house error shape", async () => {
    const entries = Array.from({ length: 1001 }, (_, i) => ({
      learnerId: `learner-${i}`,
      subject: "ENGLISH",
      score: 87,
    }));

    const res = await post({ entries });

    expect(res.ok).toBe(false);
    expect(typeof (res as { error: string }).error).toBe("string");
    expectNoWrites();
    // Refused by Zod, before the roster was read.
    expect(learnerFindMany).not.toHaveBeenCalled();
  });
});
