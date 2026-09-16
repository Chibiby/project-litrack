import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Action-level coverage for `saveKinderCompetencies` — the tenancy boundary,
 * the per-term window lock, the remark rule, the upsert diff and the audit
 * metadata.
 *
 * Same shape as `tests/unit/actions/kinder-competencies-export.test.ts`: only
 * leaf Prisma calls, the session guard, the unlock verdict, audit and cache are
 * mocked. The real Zod schema, the real competency catalog, the real
 * `getAdvisoryPlacements`/`resolveAdvisoryTarget`/`splitByKinderGradeType` and
 * the real `getTermWindows`/`isTermLocked` all run — term locks are driven by
 * the school year's own `termWindowOverrides`, with a deadline in the past for
 * a closed term and one far in the future for an open one, so no clock is
 * stubbed.
 */

const SCHOOL_ID = "school-malandag";
const KINDER_GRADE_ID = "grade-kinder";
const KINDER_SECTION_ID = "section-mabini";
const OTHER_KINDER_SECTION_ID = "section-luna";
const TEACHER_ID = "teacher-marivic";
const SCHOOL_YEAR_ID = "sy-2026-2027";
const LEARNER_ID = "learner-nico";

/** A real catalog key, so `isKinderCompetencyKey` passes. */
const KEY_A = "I.1";
const KEY_B = "I.2";

const PAST = "2000-01-01";
const FUTURE = "2999-12-31";

type LearnerRow = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  sectionId: string | null;
  deletedAt: Date | null;
  archivedAt: Date | null;
};

/** Per-term deadline keys, which is the only thing `isTermLocked` consults. */
let deadlines: { FIRST: string; SECOND: string; THIRD: string };
let learners: LearnerRow[];
let schoolYearActive: boolean;
let session: { id: string; schoolId: string | null; role: "TEACHER" | "SUPER_ADMIN" };
let grantVerdict: {
  writable: boolean;
  grantId: string | null;
  grantKind: "user" | "school" | null;
};

function learner(overrides: Partial<LearnerRow> & { id: string }): LearnerRow {
  return {
    schoolId: SCHOOL_ID,
    gradeLevelId: KINDER_GRADE_ID,
    sectionId: KINDER_SECTION_ID,
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function matchesWhere(row: LearnerRow, where: Record<string, unknown>): boolean {
  if ("id" in where && row.id !== where.id) return false;
  if ("schoolId" in where && row.schoolId !== where.schoolId) return false;
  if ("gradeLevelId" in where && row.gradeLevelId !== where.gradeLevelId) return false;
  if ("sectionId" in where && row.sectionId !== where.sectionId) return false;
  if (where.deletedAt === null && row.deletedAt !== null) return false;
  if (where.archivedAt === null && row.archivedAt !== null) return false;
  return true;
}

const learnerFindFirst = vi.fn(async (args: { where: Record<string, unknown> }) => {
  const found = learners.find((l) => matchesWhere(l, args.where));
  return found ? { id: found.id } : null;
});

const sectionFindMany = vi.fn(async (args: { where: { adviserId: string; schoolId: string } }) =>
  args.where.adviserId === TEACHER_ID && args.where.schoolId === SCHOOL_ID
    ? [
        {
          id: KINDER_SECTION_ID,
          name: "Mabini",
          gradeLevelId: KINDER_GRADE_ID,
          gradeLevel: { type: "KINDER" },
        },
      ]
    : []
);

const schoolYearFindFirst = vi.fn(async (_args?: unknown) => {
  if (!schoolYearActive) return null;
  return {
    id: SCHOOL_YEAR_ID,
    startDate: new Date("2026-08-01T00:00:00+08:00"),
    termWindowOverrides: [
      { term: "FIRST", startKey: "2026-08-01", endKey: "2026-10-31", deadlineKey: deadlines.FIRST },
      { term: "SECOND", startKey: "2026-11-01", endKey: "2027-01-31", deadlineKey: deadlines.SECOND },
      { term: "THIRD", startKey: "2027-02-01", endKey: "2027-04-30", deadlineKey: deadlines.THIRD },
    ],
  };
});

const upsert = vi.fn((args: unknown) => args);
const transaction = vi.fn(async (ops: unknown[]) => ops);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: { findFirst: (...args: unknown[]) => learnerFindFirst(...(args as [never])) },
    section: { findMany: (...args: unknown[]) => sectionFindMany(...(args as [never])) },
    schoolYear: { findFirst: (...args: unknown[]) => schoolYearFindFirst(...(args as [never])) },
    kinderCompetencyRecord: { upsert: (...args: unknown[]) => upsert(...(args as [never])) },
    $transaction: (...args: unknown[]) => transaction(...(args as [never])),
    // A "security" severity throw (the Super Admin refusal) files an
    // `ErrorEvent`; without this the recorder logs a noisy secondary failure.
    errorEvent: { create: async () => ({ id: "err-1" }) },
  },
}));

const requireUser = vi.fn(async () => session);
const requireSchoolUser = vi.fn(async () => session);
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...(args as [])),
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...(args as [])),
}));

const canWriteWindow = vi.fn(async (_args?: unknown) => grantVerdict);
vi.mock("@/lib/unlock/grants", () => ({
  canWriteWindow: (...args: unknown[]) => canWriteWindow(...(args as [never])),
}));

const writeAudit = vi.fn(async (_entry?: unknown) => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [never])),
  AUDIT_ACTIONS: {
    KINDER_COMPETENCY_BULK_SAVE: "KINDER_COMPETENCY_BULK_SAVE",
    KINDER_COMPETENCY_EXPORT: "KINDER_COMPETENCY_EXPORT",
    UNLOCK_GRANT_USED: "UNLOCK_GRANT_USED",
    UNLOCK_SCHOOL_GRANT_USED: "UNLOCK_SCHOOL_GRANT_USED",
  },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...(args as [])),
}));

// Imported after the mock factories above are registered.
const { saveKinderCompetencies } = await import("@/lib/actions/kinder-competencies");

type SaveResult = Awaited<ReturnType<typeof saveKinderCompetencies>>;

type Entry = {
  competencyKey: string;
  t1Rating?: "BEGINNING" | "DEVELOPING" | "CONSISTENT" | null;
  t2Rating?: "BEGINNING" | "DEVELOPING" | "CONSISTENT" | null;
  t3Rating?: "BEGINNING" | "DEVELOPING" | "CONSISTENT" | null;
  remark?: string | null;
};

function post(
  entries: Entry[],
  overrides: { learnerId?: string; advisorySectionId?: string } = {}
) {
  return saveKinderCompetencies({
    advisorySectionId: KINDER_SECTION_ID,
    learnerId: LEARNER_ID,
    entries,
    ...overrides,
  });
}

function errorOf(res: SaveResult): string {
  if (res.ok) throw new Error("expected a refusal, got a successful save");
  return res.error;
}

function auditFor(action: string) {
  const call = writeAudit.mock.calls.find(
    (c) => (c[0] as { action: string }).action === action
  );
  return call ? (call[0] as { metadata: Record<string, unknown>; resourceId: string }) : null;
}

beforeEach(() => {
  vi.clearAllMocks();

  deadlines = { FIRST: FUTURE, SECOND: FUTURE, THIRD: FUTURE };
  learners = [learner({ id: LEARNER_ID })];
  schoolYearActive = true;
  session = { id: TEACHER_ID, schoolId: SCHOOL_ID, role: "TEACHER" };
  grantVerdict = { writable: false, grantId: null, grantKind: null };
});

describe("saveKinderCompetencies — authorization and tenancy", () => {
  it("refuses a Super Admin, who passes the TEACHER role check by impersonation", async () => {
    session = { id: "admin-1", schoolId: SCHOOL_ID, role: "SUPER_ADMIN" };

    const res = await post([{ competencyKey: KEY_A, t1Rating: "BEGINNING" }]);

    expect(res.ok).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses a learner outside the teacher's advisory section", async () => {
    learners = [learner({ id: LEARNER_ID, sectionId: OTHER_KINDER_SECTION_ID })];

    const res = await post([{ competencyKey: KEY_A, t1Rating: "BEGINNING" }]);

    expect(res.ok).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses an advisory section the teacher does not advise", async () => {
    const res = await post([{ competencyKey: KEY_A, t1Rating: "BEGINNING" }], {
      advisorySectionId: OTHER_KINDER_SECTION_ID,
    });

    expect(res.ok).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("scopes the learner lookup by school, grade and section", async () => {
    await post([{ competencyKey: KEY_A, t1Rating: "BEGINNING" }]);

    const where = (learnerFindFirst.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({
      id: LEARNER_ID,
      schoolId: SCHOOL_ID,
      gradeLevelId: KINDER_GRADE_ID,
      sectionId: KINDER_SECTION_ID,
      deletedAt: null,
      archivedAt: null,
    });
  });

  it("refuses a competency key that is not in the catalog", async () => {
    const res = await post([{ competencyKey: "IX.99", t1Rating: "BEGINNING" }]);

    expect(res.ok).toBe(false);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("refuses when no school year is active", async () => {
    schoolYearActive = false;

    const res = await post([{ competencyKey: KEY_A, t1Rating: "BEGINNING" }]);

    expect(errorOf(res)).toMatch(/school year/i);
  });
});

describe("saveKinderCompetencies — the term window lock", () => {
  it("saves a rating while the term is open", async () => {
    const res = await post([{ competencyKey: KEY_A, t1Rating: "DEVELOPING" }]);

    expect(res.ok).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/teacher/terms-reports/kinder");
  });

  it("refuses a rating in a closed term, naming it", async () => {
    deadlines.FIRST = PAST;

    const res = await post([{ competencyKey: KEY_A, t1Rating: "DEVELOPING" }]);

    expect(errorOf(res)).toMatch(/First Term/);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not consult the closed term a save never touches", async () => {
    deadlines.THIRD = PAST;

    const res = await post([{ competencyKey: KEY_A, t1Rating: "DEVELOPING" }]);

    expect(res.ok).toBe(true);
  });

  it("accepts a closed term when an unlock grant reopens it, and audits the grant", async () => {
    deadlines.FIRST = PAST;
    grantVerdict = { writable: true, grantId: "grant-1", grantKind: "user" };

    const res = await post([{ competencyKey: KEY_A, t1Rating: "CONSISTENT" }]);

    expect(res.ok).toBe(true);
    expect(auditFor("UNLOCK_GRANT_USED")).not.toBeNull();
  });

  it("attributes a school-wide grant to the school unlock audit action", async () => {
    deadlines.SECOND = PAST;
    grantVerdict = { writable: true, grantId: "school-grant-1", grantKind: "school" };

    const res = await post([{ competencyKey: KEY_A, t2Rating: "CONSISTENT" }]);

    expect(res.ok).toBe(true);
    expect(auditFor("UNLOCK_SCHOOL_GRANT_USED")).not.toBeNull();
  });
});

describe("saveKinderCompetencies — the shared remark", () => {
  it("saves a remark while at least one term is still open", async () => {
    deadlines.FIRST = PAST;
    deadlines.SECOND = PAST;

    const res = await post([{ competencyKey: KEY_A, remark: "Needs more practice" }]);

    expect(res.ok).toBe(true);
  });

  it("refuses a remark once every term has closed", async () => {
    deadlines = { FIRST: PAST, SECOND: PAST, THIRD: PAST };

    const res = await post([{ competencyKey: KEY_A, remark: "Too late" }]);

    expect(errorOf(res)).toMatch(/every term is closed/i);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("accepts a remark with every term closed when a grant reopens one", async () => {
    deadlines = { FIRST: PAST, SECOND: PAST, THIRD: PAST };
    grantVerdict = { writable: true, grantId: "grant-1", grantKind: "user" };

    const res = await post([{ competencyKey: KEY_A, remark: "Corrected after review" }]);

    expect(res.ok).toBe(true);
  });
});

describe("saveKinderCompetencies — the upsert diff", () => {
  it("writes one upsert per entry, keyed on learner, school year and competency", async () => {
    await post([
      { competencyKey: KEY_A, t1Rating: "BEGINNING" },
      { competencyKey: KEY_B, t2Rating: "CONSISTENT" },
    ]);

    expect(upsert).toHaveBeenCalledTimes(2);
    const first = upsert.mock.calls[0][0] as {
      where: { learnerId_schoolYearId_competencyKey: Record<string, string> };
    };
    expect(first.where.learnerId_schoolYearId_competencyKey).toEqual({
      learnerId: LEARNER_ID,
      schoolYearId: SCHOOL_YEAR_ID,
      competencyKey: KEY_A,
    });
  });

  it("updates only the fields the entry touched", async () => {
    await post([{ competencyKey: KEY_A, t2Rating: "DEVELOPING" }]);

    const update = (upsert.mock.calls[0][0] as { update: Record<string, unknown> }).update;
    expect(update).toHaveProperty("t2Rating", "DEVELOPING");
    expect(update).not.toHaveProperty("t1Rating");
    expect(update).not.toHaveProperty("t3Rating");
    expect(update).not.toHaveProperty("remark");
  });

  it("clears a rating when the entry sends null", async () => {
    await post([{ competencyKey: KEY_A, t1Rating: null }]);

    const update = (upsert.mock.calls[0][0] as { update: Record<string, unknown> }).update;
    expect(update).toHaveProperty("t1Rating", null);
  });

  it("reports how many entries were saved", async () => {
    const res = await post([
      { competencyKey: KEY_A, t1Rating: "BEGINNING" },
      { competencyKey: KEY_B, t1Rating: "BEGINNING" },
    ]);

    expect(res.ok && res.data.saved).toBe(2);
  });
});

describe("saveKinderCompetencies — the audit row", () => {
  it("records ids, competency keys and per-term counts", async () => {
    await post([
      { competencyKey: KEY_A, t1Rating: "BEGINNING" },
      { competencyKey: KEY_B, t1Rating: "CONSISTENT", t3Rating: "DEVELOPING" },
    ]);

    const entry = auditFor("KINDER_COMPETENCY_BULK_SAVE");
    expect(entry?.resourceId).toBe(LEARNER_ID);
    expect(entry?.metadata).toMatchObject({
      schoolId: SCHOOL_ID,
      gradeLevelId: KINDER_GRADE_ID,
      sectionId: KINDER_SECTION_ID,
      learnerId: LEARNER_ID,
      schoolYearId: SCHOOL_YEAR_ID,
      competencyKeys: [KEY_A, KEY_B],
      savedByTerm: { t1: 2, t2: 0, t3: 1 },
    });
  });

  it("never carries a rating value or the remark text", async () => {
    await post([{ competencyKey: KEY_A, t1Rating: "BEGINNING", remark: "Absent often" }]);

    const serialized = JSON.stringify(auditFor("KINDER_COMPETENCY_BULK_SAVE")?.metadata ?? {});
    expect(serialized).not.toContain("Absent often");
    expect(serialized).not.toContain("BEGINNING");
  });
});
