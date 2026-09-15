import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { getTermWindows, isTermLocked } from "@/lib/terms/windows";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

/**
 * Action-level coverage for `saveTermGrades` — the only write behind the End of
 * Terms grade sheet.
 *
 * Subjects are now School Head-managed `TermSubject` rows, posted by id
 * (`docs/superpowers/specs/2026-09-14-term-subjects-management-design.md`).
 * `getSheetSubjects` is real code here, not mocked — only its leaf,
 * `prisma.termSubject.findMany`/`.createMany`, is a fake. That keeps the real
 * lazy-seed and ordering logic in the loop, so a fixture with zero rows would
 * genuinely exercise the seed path the same way production does.
 *
 * The design lists six refusals, and every one of them is enforced here and
 * nowhere else: the grid disables its inputs and hides its Save button, but a
 * client is not an enforcement point. What is contract, and so asserted rather
 * than assumed:
 *
 *   - The roster is read through `schoolId` AND the adviser's own section, so a
 *     learner from another tenant or another section cannot be graded by id. A
 *     partial match fails the WHOLE batch with one generic message — that is what
 *     stops a probe from telling "another school's" apart from "not my section",
 *     and what stops the valid half of a poisoned batch from being written.
 *   - Every posted `termSubjectId` must be on THIS grade's ACTIVE sheet, in THIS
 *     school — one not in `getSheetSubjects`' result (wrong grade, wrong school,
 *     or archived) fails the WHOLE batch, same reasoning as the roster check.
 *   - Every placement fact is re-derived server-side. The posted `gradeLevelId` is
 *     checked against the advisory, never trusted.
 *   - A locked term, a missing school year, a non-adviser and a Super Admin all
 *     refuse before any write.
 *   - Scores never reach `AuditLog`. They are learner PII (`docs/privacy.md`); the
 *     row carries placement, counts and learner ids only.
 *
 * Only leaf infrastructure is mocked (Prisma client, session, audit, cache). The
 * real Zod schema, the real `getAdvisoryPlacement`, the real `deniesAdvisoryRoster`,
 * the real term-window maths and the real `getSheetSubjects`/`orderSheetSubjects`
 * all run, so the `where` clauses these tests inspect are the ones the action
 * would send to Postgres.
 */

const TEACHER_ID = "teacher-marivic";
const SCHOOL_ID = "school-malandag";
const OTHER_SCHOOL_ID = "school-kiblawan";
const SECTION_ID = "section-sampaguita";
const OTHER_SECTION_ID = "section-rosal";
const GRADE_ID = "grade-g7";
const OTHER_GRADE_ID = "grade-g8";
const SCHOOL_YEAR_ID = "sy-2026-2027";

/** This grade's active sheet, by name — stable ids reused across every test. */
const SUBJECT_IDS: Record<string, string> = {
  ENGLISH: "subject-english",
  FILIPINO: "subject-filipino",
  MATHEMATICS: "subject-mathematics",
  SCIENCE: "subject-science",
  ARALING_PANLIPUNAN: "subject-araling-panlipunan",
  EDUKASYON_SA_PAGPAPAKATAO: "subject-edukasyon-sa-pagpapakatao",
  MAPEH: "subject-mapeh",
  TLE: "subject-tle",
};
/** Lives on OTHER_GRADE_ID, same school. */
const FOREIGN_GRADE_SUBJECT_ID = "subject-other-grade";
/** Lives on GRADE_ID, but OTHER_SCHOOL_ID. */
const FOREIGN_SCHOOL_SUBJECT_ID = "subject-other-school";
/** Lives on GRADE_ID/SCHOOL_ID, but archived. */
const ARCHIVED_SUBJECT_ID = "subject-archived";

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
  /** Who advises it, authoritative since Wave A of multi-advisory. */
  adviserId: string | null;
};

type SchoolYearRow = {
  id: string;
  schoolId: string;
  isActive: boolean;
  startDate: Date;
  termWindowOverrides: {
    term: string;
    startKey: string;
    endKey: string;
    deadlineKey: string;
  }[];
};

type TermSubjectRow = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  name: string;
  position: number;
  deletedAt: Date | null;
};

/** The school's learner table for one test. */
let learners: LearnerRow[];
let sections: SectionRow[];
let schoolYears: SchoolYearRow[];
/** Every `TermSubject` row the fake Prisma client knows about, live grade or not. */
let termSubjects: TermSubjectRow[];
/** `TeacherProfile.designation` for the caller; `null` is an ordinary DepEd teacher. */
let designation: string | null;
/** `TeacherProfile.advisoryMode`; `null` behaves as DEFAULT for an older row. */
let advisoryMode: "DEFAULT" | "FLOATING" | "MULTI_GRADE" | null;
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

/** This grade's 8 default subjects, active, positions 0-7 — the sheet's shape. */
function defaultSubjects(): TermSubjectRow[] {
  return Object.entries(SUBJECT_IDS).map(([name, id], position) => ({
    id,
    schoolId: SCHOOL_ID,
    gradeLevelId: GRADE_ID,
    name,
    position,
    deletedAt: null,
  }));
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

/**
 * Backs `getAllTermSubjects` (`src/lib/terms/subjects-db.ts`), real code and not
 * mocked. Only its leaf — this delegate — is a fake, so the real lazy-seed and
 * `orderSheetSubjects` logic both run exactly as in production.
 */
const termSubjectFindMany = vi.fn(
  async (args: { where: { schoolId: string; gradeLevelId: string } }) =>
    termSubjects
      .filter(
        (s) =>
          s.schoolId === args.where.schoolId && s.gradeLevelId === args.where.gradeLevelId
      )
      .map((s) => ({ id: s.id, name: s.name, position: s.position, deletedAt: s.deletedAt }))
);
/** Never expected to fire in this file: every fixture grade already has rows. */
const termSubjectCreateMany = vi.fn(async (_args?: unknown) => ({ count: 0 }));

/**
 * Backs the real `getAdvisoryPlacements`, tenant filter and soft delete
 * included.
 *
 * A `findMany` on `Section.adviserId` since Wave A of multi-advisory, where it
 * used to be a `findFirst` on the id the session carried. The session pointer is
 * gone from that path entirely: which sections a teacher advises is now a
 * property of the sections, not of the user row.
 */
const sectionFindMany = vi.fn(
  async (args: {
    where: { adviserId: string; schoolId: string; deletedAt: null };
  }) =>
    sections
      .filter(
        (s) =>
          s.adviserId === args.where.adviserId &&
          s.schoolId === args.where.schoolId &&
          s.deletedAt === null
      )
      .map((s) => ({
        id: s.id,
        name: s.name,
        gradeLevelId: s.gradeLevelId,
        gradeLevel: { type: s.gradeType },
      }))
);

/** Still used by other reads in this file. */
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
    return { designation, advisoryMode };
  }
);

const schoolYearFindFirst = vi.fn(
  async (args: { where: { schoolId: string; isActive: boolean } }) => {
    const found = schoolYears.find(
      (y) => y.schoolId === args.where.schoolId && y.isActive === args.where.isActive
    );
    return found
      ? {
          id: found.id,
          startDate: found.startDate,
          termWindowOverrides: found.termWindowOverrides,
        }
      : null;
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
 * `queryRaw` below is not a stub. It models the tenant + subject JOIN in the real
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
/** Makes the statement RETURN one row fewer than it was given — see the guard test. */
let dropOneReturnedRow = false;

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
    const returned = params
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
    // One row silently skipped by the JOIN. Postgres reports no error for that, so
    // the guard is the only thing standing between it and a partial save reported
    // as a success. See the RETURNING-count-guard test.
    return dropOneReturnedRow ? returned.slice(1) : returned;
  }
);

const termGradeDeleteMany = vi.fn(async (args: unknown) => ({ count: 1, args }));

/** Backs `healLegacyTermGrades` inside the save transaction. */
const healExecuteRaw = vi.fn(
  async (_sql: { strings: readonly string[]; values: unknown[] }) => 0
);
/** Order of raw statements issued on the transaction client. */
let txOrder: string[] = [];

/**
 * The save path is an INTERACTIVE transaction now (the raw statement has to be
 * awaited, and the delete has to be ordered before it), so the callback is run
 * against a `tx` client wired to the same mocks.
 */
const transaction = vi.fn(async (arg: unknown, _options?: unknown) => {
  if (typeof arg === "function") {
    return (arg as (tx: unknown) => unknown)({
      $executeRaw: (...a: unknown[]) => {
        txOrder.push("heal");
        return healExecuteRaw(...(a as [never]));
      },
      $queryRaw: (...a: unknown[]) => {
        txOrder.push("upsert");
        return queryRaw(...(a as [never]));
      },
      termGrade: {
        deleteMany: (...a: unknown[]) => termGradeDeleteMany(...(a as [never])),
      },
    });
  }
  return arg;
});

/**
 * The two grant tables `canWriteWindow` reads from — left un-mocked at the
 * module level so the real `canWriteWindow` runs here, exactly as the
 * "refuses a term whose months have passed" test above already depends on
 * for its fail-closed behaviour when both resolve to `null`.
 */
const unlockGrantFindFirst = vi.fn(async (_args?: unknown) => null as unknown);
const schoolUnlockGrantFindFirst = vi.fn(async (_args?: unknown) => null as unknown);

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
      findMany: (...args: unknown[]) => sectionFindMany(...(args as [never])),
    },
    teacherProfile: {
      findFirst: (...args: unknown[]) => teacherProfileFindFirst(...(args as [never])),
    },
    schoolYear: {
      findFirst: (...args: unknown[]) => schoolYearFindFirst(...(args as [never])),
    },
    termSubject: {
      findMany: (...args: unknown[]) => termSubjectFindMany(...(args as [never])),
      createMany: (...args: unknown[]) => termSubjectCreateMany(...(args as [never])),
    },
    unlockGrant: {
      findFirst: (...args: unknown[]) => unlockGrantFindFirst(...(args as [never])),
    },
    schoolUnlockGrant: {
      findFirst: (...args: unknown[]) =>
        schoolUnlockGrantFindFirst(...(args as [never])),
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
    UNLOCK_GRANT_USED: "UNLOCK_GRANT_USED",
    UNLOCK_SCHOOL_GRANT_USED: "UNLOCK_SCHOOL_GRANT_USED",
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

/**
 * Submission locking, ON for this suite.
 *
 * This file's subject is the term deadline, so it runs in the regime where
 * deadlines are enforced. Mocked rather than left to the real reader, which
 * would reach `prisma.systemSetting` — absent from the Prisma mock above — and
 * degrade to "off", quietly turning every locked-term assertion here into a
 * test of the unlocked path. The switched-off case has its own test below.
 */
const isSubmissionLockingEnabled = vi.fn(async () => true);
vi.mock("@/lib/settings/system-settings", () => ({
  isSubmissionLockingEnabled: () => isSubmissionLockingEnabled(),
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

type Entry = { learnerId: string; termSubjectId: string; score: number | null };

function post(overrides: {
  gradeLevelId?: string;
  term?: string;
  entries?: Entry[];
} = {}) {
  return saveTermGrades({
    gradeLevelId: GRADE_ID,
    term: OPEN_TERM,
    entries: [{ learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 }],
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
      adviserId: TEACHER_ID,
    },
  ];
  schoolYears = [
    {
      id: SCHOOL_YEAR_ID,
      schoolId: SCHOOL_ID,
      isActive: true,
      startDate: SCHOOL_YEAR_START,
      termWindowOverrides: [],
    },
  ];
  termSubjects = [
    ...defaultSubjects(),
    {
      id: FOREIGN_GRADE_SUBJECT_ID,
      schoolId: SCHOOL_ID,
      gradeLevelId: OTHER_GRADE_ID,
      name: "Other Grade Subject",
      position: 0,
      deletedAt: null,
    },
    {
      id: FOREIGN_SCHOOL_SUBJECT_ID,
      schoolId: OTHER_SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      name: "Other School Subject",
      position: 0,
      deletedAt: null,
    },
    {
      id: ARCHIVED_SUBJECT_ID,
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      name: "Archived Subject",
      position: 99,
      deletedAt: new Date(2026, 8, 1),
    },
  ];
  designation = null;
  advisoryMode = null;
  session = {
    id: TEACHER_ID,
    schoolId: SCHOOL_ID,
    role: "TEACHER",
    advisorySectionId: SECTION_ID,
  };
  learnerFindManyArgs = [];
  rawWrites = [];
  txOrder = [];
  dropOneReturnedRow = false;
  unlockGrantFindFirst.mockResolvedValue(null);
  schoolUnlockGrantFindFirst.mockResolvedValue(null);
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
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 },
        { learnerId: "learner-b", termSubjectId: SUBJECT_IDS.MATHEMATICS, score: 93 },
        { learnerId: "learner-b", termSubjectId: SUBJECT_IDS.SCIENCE, score: null },
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
        OR: [{ learnerId: "learner-b", termSubjectId: SUBJECT_IDS.SCIENCE }],
        termSubject: { gradeLevelId: GRADE_ID, deletedAt: null },
      },
    });

    const { sql, params } = rawWrites[0];
    // The conflict target IS the unique constraint, and `updatedAt` is bumped in
    // the DO UPDATE branch. Prisma's `@updatedAt` is client-side and there is no
    // database trigger, so omitting that clause would freeze the column at
    // first-insert time forever — silently, with nothing to fail.
    expect(sql).toContain(
      'ON CONFLICT ("learnerId", "schoolYearId", "term", "termSubjectId") DO UPDATE'
    );
    expect(sql).toContain('"updatedAt" = EXCLUDED."updatedAt"');
    // The subject JOIN — new in the TermSubject rewrite — re-checks the row's
    // tenancy and liveness inside the statement itself, which is what catches an
    // archive that lands mid-save.
    expect(sql).toContain('JOIN "TermSubject" ts');
    expect(sql).toContain('ts."deletedAt" IS NULL');
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
    // The posted subject ids are bound values too.
    expect(params).toContain(SUBJECT_IDS.ENGLISH);
    expect(params).toContain(SUBJECT_IDS.MATHEMATICS);
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
      grantKind: null,
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

  it("reads the sheet's subjects scoped to the school AND the advisory grade", async () => {
    await post();

    expect(termSubjectFindMany).toHaveBeenCalledTimes(1);
    expect(termSubjectFindMany.mock.calls[0][0].where).toEqual({
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
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

  /**
   * §3: the programme-wide switch. With deadlines off, the same closed term the
   * first case refuses is accepted — from the same teacher, with no grant
   * anywhere. This is the pair that proves the switch reaches this action, and
   * it fails if `canWriteWindow` is ever bypassed here.
   */
  it("accepts that same closed term when deadlines are switched off", async () => {
    isSubmissionLockingEnabled.mockResolvedValueOnce(false);

    const res = await post({ term: LOCKED_TERM });

    expect(res).toEqual({ ok: true, data: { saved: 1, cleared: 0 } });
  });

  it("accepts a save past the months when the head extended the deadline", async () => {
    // First Term's months ended Oct 31. The head moved entry to Dec 31, and the
    // frozen clock is Dec 15 — inside the extension, past the months.
    schoolYears[0].termWindowOverrides = [
      {
        term: "FIRST",
        startKey: "2026-08-01",
        endKey: "2026-10-31",
        deadlineKey: "2026-12-31",
      },
    ];

    const res = await post({ term: LOCKED_TERM });

    expect(res.ok).toBe(true);
  });

  it("still refuses a save past the extended deadline", async () => {
    // Extended, but only to Nov 30 — the clock is past that too.
    schoolYears[0].termWindowOverrides = [
      {
        term: "FIRST",
        startKey: "2026-08-01",
        endKey: "2026-10-31",
        deadlineKey: "2026-11-30",
      },
    ];

    const res = await post({ term: LOCKED_TERM });

    expect(res.ok).toBe(false);
    expect(res).toMatchObject({
      error: expect.stringContaining("First Term is closed"),
    });
  });
});

describe("saveTermGrades — which grant table wrote the second audit row", () => {
  // A school-wide grant lives in a DIFFERENT table (`SchoolUnlockGrant`) than a
  // personal one (`UnlockGrant`). Joining its id against `UnlockGrant` finds
  // nothing, so the second audit row must name the right table — in `action`
  // AND in `resource` — not just carry `grantKind` in `metadata`. Mirrors the
  // pair in `tests/unit/actions/attendance-week-save.test.ts`.
  it("writes UNLOCK_GRANT_USED against UnlockGrant for a personal grant", async () => {
    unlockGrantFindFirst.mockResolvedValue({
      id: "grant-personal-1",
      expiresAt: new Date(2099, 0, 1),
      grantedBy: null,
    });

    const res = await post({ term: LOCKED_TERM });

    expect(res.ok).toBe(true);
    expect(writeAudit).toHaveBeenCalledTimes(2);
    expect(writeAudit.mock.calls[0][0]).toMatchObject({
      action: "TERM_GRADES_BULK_SAVE",
      metadata: expect.objectContaining({ grantKind: "user" }),
    });
    expect(writeAudit.mock.calls[1][0]).toMatchObject({
      action: "UNLOCK_GRANT_USED",
      resource: "UnlockGrant",
      resourceId: "grant-personal-1",
      metadata: expect.objectContaining({ grantKind: "user" }),
    });
  });

  it("writes UNLOCK_SCHOOL_GRANT_USED against SchoolUnlockGrant for a school-wide grant", async () => {
    schoolUnlockGrantFindFirst.mockResolvedValue({
      id: "grant-school-1",
      expiresAt: new Date(2099, 0, 1),
      grantedBy: null,
    });

    const res = await post({ term: LOCKED_TERM });

    expect(res.ok).toBe(true);
    expect(writeAudit).toHaveBeenCalledTimes(2);
    expect(writeAudit.mock.calls[0][0]).toMatchObject({
      action: "TERM_GRADES_BULK_SAVE",
      metadata: expect.objectContaining({ grantKind: "school" }),
    });
    expect(writeAudit.mock.calls[1][0]).toMatchObject({
      action: "UNLOCK_SCHOOL_GRANT_USED",
      resource: "SchoolUnlockGrant",
      resourceId: "grant-school-1",
      metadata: expect.objectContaining({ grantKind: "school" }),
    });
  });
});

describe("saveTermGrades — refusal 2: a learner outside the advisory section", () => {
  it("refuses a real learner in another section of the same grade", async () => {
    learners.push(learner({ id: "learner-other-section", sectionId: OTHER_SECTION_ID }));

    const res = await post({
      entries: [
        { learnerId: "learner-other-section", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 },
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
      entries: [{ learnerId: "learner-other-grade", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 }],
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
        entries: [{ learnerId: id, termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 }],
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
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 },
        { learnerId: "learner-other-section", termSubjectId: SUBJECT_IDS.ENGLISH, score: 93 },
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
      entries: [{ learnerId: "learner-other-school", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 }],
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
      entries: [{ learnerId: "learner-other-school", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 }],
    });
    vi.clearAllMocks();
    const crossSection = await post({
      entries: [{ learnerId: "learner-near", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 }],
    });
    vi.clearAllMocks();
    const nonexistent = await post({
      entries: [{ learnerId: "learner-does-not-exist", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 }],
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
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 },
        { learnerId: "learner-other-school", termSubjectId: SUBJECT_IDS.MATHEMATICS, score: 93 },
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
      entries: [{ learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 }],
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
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 },
        { learnerId: "learner-other-school", termSubjectId: SUBJECT_IDS.MATHEMATICS, score: 93 },
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
        termWindowOverrides: [],
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
        termWindowOverrides: [],
      },
    ];

    const res = await post();
    expect(res.ok).toBe(false);
    expectNoWrites();
  });
});

describe("saveTermGrades — refusal 5: a caller who advises nothing", () => {
  it("refuses a teacher with no advisory placement", async () => {
    // Advising nothing is now a property of the SECTIONS, not of the session
    // pointer: `getAdvisoryPlacements` asks which sections name this teacher.
    for (const s of sections) s.adviserId = null;

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

  it("refuses a floating teacher in words that fit a DepEd teacher", async () => {
    // A floating teacher IS a DepEd teacher, so the volunteer copy would be
    // false about them and would point them at the wrong remedy.
    advisoryMode = "FLOATING";

    const res = await post();

    expect(res).toEqual({
      ok: false,
      error:
        "Floating teachers do not advise a section, so there is no end-of-term sheet. Your School Head can change this.",
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

describe("saveTermGrades — refusal 6: a termSubjectId no longer on this grade's sheet", () => {
  // §7 of the design: a posted subject id must be in THIS grade's ACTIVE sheet,
  // in THIS school — anything else (wrong grade, wrong school, or archived)
  // refuses the whole batch with one generic message, same reasoning as the
  // roster check in refusal 2/3.
  it("refuses a subject id that belongs to another grade of the same school", async () => {
    const res = await post({
      entries: [
        { learnerId: "learner-a", termSubjectId: FOREIGN_GRADE_SUBJECT_ID, score: 87 },
      ],
    });

    expect(res).toEqual({
      ok: false,
      error: "One or more subjects are no longer on this sheet. Reload the page.",
    });
    expectNoWrites();
  });

  it("refuses a subject id that belongs to another school entirely", async () => {
    const res = await post({
      entries: [
        { learnerId: "learner-a", termSubjectId: FOREIGN_SCHOOL_SUBJECT_ID, score: 87 },
      ],
    });

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toContain("no longer on this sheet");
    expectNoWrites();
    // And the message names nothing about the other school.
    expect(JSON.stringify(res)).not.toContain(OTHER_SCHOOL_ID);
  });

  it("refuses an archived subject id, even though the row still physically exists", async () => {
    const res = await post({
      entries: [{ learnerId: "learner-a", termSubjectId: ARCHIVED_SUBJECT_ID, score: 87 }],
    });

    expect(res.ok).toBe(false);
    expect((res as { error: string }).error).toContain("no longer on this sheet");
    expectNoWrites();
  });

  it("writes NOTHING for the valid half of a batch with one stale subject id", async () => {
    // Same fail-closed shape as the roster checks: one bad subject id must not
    // let the rest of the sheet save silently around it.
    const res = await post({
      entries: [
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 },
        { learnerId: "learner-a", termSubjectId: ARCHIVED_SUBJECT_ID, score: 93 },
      ],
    });

    expect(res.ok).toBe(false);
    expectNoWrites();
  });

  it("checks subjects only after the roster has already cleared", async () => {
    // A learner problem is reported before a subject problem is even looked at —
    // the roster read happens first in the action, so the subject fetch never
    // fires when the roster already refused the batch.
    learners.push(learner({ id: "learner-other-section", sectionId: OTHER_SECTION_ID }));

    await post({
      entries: [
        { learnerId: "learner-other-section", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 },
      ],
    });

    expect(termSubjectFindMany).not.toHaveBeenCalled();
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
        entries: [{ learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score }],
      });
      expect(res.ok).toBe(false);
      expectNoWrites();
      expect(learnerFindMany).not.toHaveBeenCalled();
    }
  });

  it("counts a repeated learner id once when checking the roster", async () => {
    // Deduped before the length comparison, or the count check would reject a
    // learner who legitimately has many subjects on one sheet.
    const res = await post({
      entries: [
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 },
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.FILIPINO, score: 93 },
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.MATHEMATICS, score: 99 },
      ],
    });

    expect(res).toEqual({ ok: true, data: { saved: 3, cleared: 0 } });
    expect(learnerFindManyArgs[0].where.id).toEqual({ in: ["learner-a"] });
  });
});

describe("saveTermGrades — the RETURNING count guard", () => {
  it("refuses the whole save when the statement writes fewer rows than it was given", async () => {
    // The last defence against a silently skipped row. The JOIN drops any learner
    // that is soft-deleted, archived, or outside the caller's tenant or section, and
    // Postgres reports NO error for that — the teacher would see a saved grade sheet
    // with one learner's marks missing. Nothing else in this file fires the branch,
    // so an inverted or deleted comparison would go unnoticed.
    dropOneReturnedRow = true;

    const res = await post({
      entries: [
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 },
        { learnerId: "learner-b", termSubjectId: SUBJECT_IDS.MATHEMATICS, score: 93 },
      ],
    });

    expect(res).toEqual({
      ok: false,
      error: "Could not save the grade sheet. Please try again.",
    });
    // The throw is inside the transaction, so the delete rolls back with it.
    expect(writeAudit).not.toHaveBeenCalled();
    // The row count is not leaked to the client.
    expect((res as { error: string }).error).not.toMatch(/\d/);
  });
});

describe("saveTermGrades — pre-M2 legacy rows", () => {
  it("heals legacy rows for this school+grade+year inside the transaction, before the upsert", async () => {
    const res = await post();

    expect(res.ok).toBe(true);
    expect(healExecuteRaw).toHaveBeenCalledTimes(1);
    const { values } = healExecuteRaw.mock.calls[0][0];
    expect(values).toContain(SCHOOL_ID);
    expect(values).toContain(GRADE_ID);
    expect(values).toContain(SCHOOL_YEAR_ID);
    expect(txOrder).toEqual(["heal", "upsert"]);
  });

  it("writes the TermSubject's legacyArea as subject, on insert AND on conflict", async () => {
    await post();

    const { sql } = rawWrites[0];
    expect(sql).toContain('"subject"');
    expect(sql).toContain('ts."legacyArea"');
    expect(sql).toMatch(/"subject" = COALESCE\(EXCLUDED\."subject"/);
  });

  it("falls back to NULL only when another row already holds this legacyArea under a different termSubjectId", async () => {
    // The guard that makes it safe to write `ts."legacyArea"` at all: without it, a
    // learner who moved grades mid-term (or a legacy row the heal above had to
    // skip) could collide on `TermGrade_learnerId_schoolYearId_term_subject_key`.
    // Deleting the `IS DISTINCT FROM` clause, or the `EXISTS` it guards, would still
    // satisfy the previous test — this one is what actually pins the fallback.
    await post();

    const { sql } = rawWrites[0];
    const normalized = sql.replace(/\s+/g, " ");
    expect(normalized).toMatch(
      /CASE WHEN EXISTS \( SELECT 1 FROM "TermGrade" o WHERE o\."learnerId" = v\."learnerId" AND o\."schoolYearId" = v\."schoolYearId" AND o\."term" = v\."term" AND o\."subject" = ts\."legacyArea" AND o\."termSubjectId" IS DISTINCT FROM v\."termSubjectId" \) THEN NULL ELSE ts\."legacyArea" END/
    );
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
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 },
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 93 },
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
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: null },
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: null },
      ],
    });

    expect(res).toEqual({ ok: true, data: { saved: 0, cleared: 1 } });
    expect(termGradeDeleteMany.mock.calls[0][0]).toEqual({
      where: {
        schoolYearId: SCHOOL_YEAR_ID,
        term: OPEN_TERM,
        OR: [{ learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH }],
        termSubject: { gradeLevelId: GRADE_ID, deletedAt: null },
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
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: null },
        { learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 87 },
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
    const subjectIds = Object.values(SUBJECT_IDS);
    const entries = learners.flatMap((l) =>
      subjectIds.map((termSubjectId) => ({ learnerId: l.id, termSubjectId, score: 87 }))
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

  it("accepts the new 1500-entry cap — 100 learners x 15 subjects, the per-grade max", async () => {
    // The cap moved with the School Head-managed sheet: a grade can now hold up
    // to MAX_ACTIVE_SUBJECTS_PER_GRADE (15) subjects, not the fixed 8. A payload
    // this size must be accepted, not rejected by a schema still pinned to 1000.
    const extraSubjects = Array.from({ length: 7 }, (_, i) => ({
      id: `subject-extra-${i}`,
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      name: `Extra ${i}`,
      position: 8 + i,
      deletedAt: null,
    }));
    termSubjects.push(...extraSubjects);
    const subjectIds = [...Object.values(SUBJECT_IDS), ...extraSubjects.map((s) => s.id)];
    expect(subjectIds).toHaveLength(15);

    learners = Array.from({ length: 100 }, (_, i) => learner({ id: `learner-${i}` }));
    const entries = learners.flatMap((l) =>
      subjectIds.map((termSubjectId) => ({ learnerId: l.id, termSubjectId, score: 87 }))
    );
    expect(entries).toHaveLength(1500);

    const res = await post({ entries });

    expect(res).toEqual({ ok: true, data: { saved: 1500, cleared: 0 } });
  });

  it("rejects more than 1500 entries with the house error shape", async () => {
    const entries = Array.from({ length: 1501 }, (_, i) => ({
      learnerId: `learner-${i}`,
      termSubjectId: SUBJECT_IDS.ENGLISH,
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

/**
 * v2: the All Advisories sheet saves one section at a time and names it. A
 * multi-advisory teacher's save used to be refused outright ("Choose which one
 * this belongs to") because nothing on the sheet could say which section.
 */
describe("saveTermGrades — a named advisory section (sectionId)", () => {
  function addSecondAdvisoryInGrade() {
    sections.push({
      id: OTHER_SECTION_ID,
      name: "Rosal",
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      gradeType: "G7",
      deletedAt: null,
      adviserId: TEACHER_ID,
    });
    learners.push(learner({ id: "learner-rosal", sectionId: OTHER_SECTION_ID }));
  }

  it("still asks which section when a multi-advisory save names none", async () => {
    addSecondAdvisoryInGrade();
    const res = await post();
    expect(res.ok).toBe(false);
    expect(learnerFindMany).not.toHaveBeenCalled();
  });

  it("saves into the section it names, through that section's roster clause", async () => {
    addSecondAdvisoryInGrade();
    const res = await saveTermGrades({
      gradeLevelId: GRADE_ID,
      sectionId: OTHER_SECTION_ID,
      term: OPEN_TERM,
      entries: [{ learnerId: "learner-rosal", termSubjectId: SUBJECT_IDS.ENGLISH, score: 88 }],
    });
    expect(res.ok).toBe(true);
    expect(learnerFindManyArgs[0].where).toMatchObject({
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      sectionId: OTHER_SECTION_ID,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/teacher/terms-reports");
  });

  it("refuses a section the teacher does not advise", async () => {
    const res = await saveTermGrades({
      gradeLevelId: GRADE_ID,
      sectionId: "section-someone-else",
      term: OPEN_TERM,
      entries: [{ learnerId: "learner-a", termSubjectId: SUBJECT_IDS.ENGLISH, score: 88 }],
    });
    expect(res.ok).toBe(false);
    expect(learnerFindMany).not.toHaveBeenCalled();
  });
});
