import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { MAX_ACTIVE_SUBJECTS_PER_GRADE } from "@/lib/terms/subjects";

/**
 * Action-level coverage for the School Head End of Terms subject console
 * (`src/lib/actions/term-subjects.ts`).
 *
 * §0 of the design overrides the ordinary School Head/Super Admin split:
 * **Super Admin CAN edit**, and the school every write is scoped and audited
 * against is derived from the TARGET row (the grade, or the subject), never
 * from the caller's own `schoolId` — a Super Admin carries none. A School Head
 * still goes through the ordinary `schoolId: user.schoolId` + `assertSameSchool`
 * gate, so a grade or subject in another school reads as a generic NOT_FOUND to
 * them, identical to one that does not exist.
 *
 * Deviation accepted by the project lead from the original design text: a
 * duplicate name, a stale reorder, and a FLOATING grade all throw
 * `VALIDATION_FAILED` (not `DB_CONFLICT`) — asserted here as the actual codes,
 * because a test that only checked `ok === false` would not notice the code
 * drifting back.
 *
 * `getAllTermSubjects`/`getSheetSubjects` (`src/lib/terms/subjects-db.ts`) and
 * `planSubjectReorder`/`nextPosition` (`src/lib/terms/subjects.ts`) are real
 * code here, not mocked — only their leaves (`prisma.termSubject.*`) are fakes,
 * so the lazy seed, the cap check and the reorder plan all run exactly as
 * production would.
 */

const HEAD_ID = "head-remedios";
const OTHER_HEAD_ID = "head-other";
const ADMIN_ID = "admin-super";
const SCHOOL_ID = "school-malandag";
const OTHER_SCHOOL_ID = "school-kiblawan";
const GRADE_ID = "grade-g7";
const FLOATING_GRADE_ID = "grade-floating";
const ARCHIVED_GRADE_ID = "grade-archived";
/** Real grade, lives in OTHER_SCHOOL_ID. */
const FOREIGN_GRADE_ID = "grade-kiblawan-g7";

type GradeRow = { id: string; schoolId: string; deletedAt: Date | null; type: string };
type SubjectRow = {
  id: string;
  schoolId: string;
  gradeLevelId: string;
  name: string;
  position: number;
  deletedAt: Date | null;
};

let grades: GradeRow[];
let termSubjects: SubjectRow[];
/** Super Admin's tenant-less per-`GradeLevelType` templates, keyed by type. */
let defaultsByType: Record<
  string,
  { id: string; name: string; position: number; deletedAt: Date | null }[]
>;
/** Live/soft-deleted schools, for `resetSchoolTermSubjects`'s Super Admin path. */
let schools: { id: string; deletedAt: Date | null }[];
/** What `requireUser` resolves for the current test. */
let session: { id: string; schoolId: string | null; role: "SCHOOL_HEAD" | "SUPER_ADMIN" };

const HEAD = { id: HEAD_ID, schoolId: SCHOOL_ID, role: "SCHOOL_HEAD" as const };
const OTHER_HEAD = { id: OTHER_HEAD_ID, schoolId: OTHER_SCHOOL_ID, role: "SCHOOL_HEAD" as const };
const ADMIN = { id: ADMIN_ID, schoolId: null, role: "SUPER_ADMIN" as const };

const nameKey = (name: string) => name.trim().toLowerCase();

const gradeLevelFindFirst = vi.fn(
  async (args: { where: { id: string; deletedAt: null; schoolId?: string } }) => {
    const found = grades.find(
      (g) =>
        g.id === args.where.id &&
        g.deletedAt === null &&
        (!("schoolId" in args.where) || g.schoolId === args.where.schoolId)
    );
    return found ? { id: found.id, schoolId: found.schoolId, type: found.type } : null;
  }
);

/** The Super Admin's per-`GradeLevelType` template — tenant-less. */
const termSubjectDefaultFindMany = vi.fn(
  async (args: { where: { gradeLevelType: string; deletedAt: null } }) =>
    (defaultsByType[args.where.gradeLevelType] ?? []).filter((d) => d.deletedAt === null)
);

/** `resetSchoolTermSubjects`'s Super Admin liveness check. */
const schoolFindFirst = vi.fn(async (args: { where: { id: string; deletedAt: null } }) => {
  const found = schools.find((s) => s.id === args.where.id && s.deletedAt === null);
  return found ? { id: found.id } : null;
});

const termSubjectFindFirst = vi.fn(
  async (args: { where: { id: string; schoolId?: string } }) => {
    const found = termSubjects.find(
      (s) =>
        s.id === args.where.id &&
        (!("schoolId" in args.where) || s.schoolId === args.where.schoolId)
    );
    if (!found) return null;
    const grade = grades.find((g) => g.id === found.gradeLevelId);
    return {
      id: found.id,
      name: found.name,
      schoolId: found.schoolId,
      gradeLevelId: found.gradeLevelId,
      deletedAt: found.deletedAt,
      gradeLevel: { type: grade?.type ?? "G7", deletedAt: grade?.deletedAt ?? null },
    };
  }
);

/** Real `getAllTermSubjects` reads through this — schoolId + gradeLevelId only. */
const termSubjectFindMany = vi.fn(
  async (args: { where: { schoolId: string; gradeLevelId: string } }) =>
    termSubjects
      .filter(
        (s) =>
          s.schoolId === args.where.schoolId && s.gradeLevelId === args.where.gradeLevelId
      )
      .map((s) => ({ id: s.id, name: s.name, position: s.position, deletedAt: s.deletedAt }))
);
/**
 * The cold-seed AND `resetSchoolTermSubjects`'s `toCreate` both land here.
 * Pushes real rows so later reads (and tally assertions) see them.
 */
let nextSeededId = 0;
const termSubjectCreateMany = vi.fn(
  async (args: {
    data: {
      schoolId: string;
      gradeLevelId: string;
      name: string;
      position: number;
      legacyArea?: string | null;
    }[];
  }) => {
    for (const d of args.data) {
      termSubjects.push({
        id: `subject-seeded-${++nextSeededId}`,
        schoolId: d.schoolId,
        gradeLevelId: d.gradeLevelId,
        name: d.name,
        position: d.position,
        deletedAt: null,
      });
    }
    return { count: args.data.length };
  }
);

let nextCreatedId = 0;
const termSubjectCreate = vi.fn(
  async (args: {
    data: { schoolId: string; gradeLevelId: string; name: string; position: number };
    select?: unknown;
  }) => {
    const clash = termSubjects.some(
      (s) =>
        s.gradeLevelId === args.data.gradeLevelId &&
        s.deletedAt === null &&
        nameKey(s.name) === nameKey(args.data.name)
    );
    if (clash) {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      });
    }
    const id = `subject-new-${++nextCreatedId}`;
    termSubjects.push({
      id,
      schoolId: args.data.schoolId,
      gradeLevelId: args.data.gradeLevelId,
      name: args.data.name,
      position: args.data.position,
      deletedAt: null,
    });
    return { id };
  }
);

/**
 * Backs every `updateMany` call the actions make (rename, archive, restore,
 * reorder), on the top-level delegate AND on `tx`. Simulates the SQL-only
 * partial unique index on `(gradeLevelId, lower(btrim(name)))` for active rows,
 * the same way real Postgres would reject the update with P2002 — this is what
 * lets "restore name clash refused" and "duplicate name refused" exercise the
 * real `nameTaken()` mapping in the action rather than a scripted result.
 */
const termSubjectUpdateMany = vi.fn(
  async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const { where, data } = args;
    const matches = termSubjects.filter((s) => {
      if ("id" in where) {
        const idClause = where.id;
        if (typeof idClause === "string") {
          if (s.id !== idClause) return false;
        } else if (idClause && typeof idClause === "object" && "in" in idClause) {
          if (!(idClause as { in: string[] }).in.includes(s.id)) return false;
        }
      }
      if ("schoolId" in where && s.schoolId !== where.schoolId) return false;
      if ("gradeLevelId" in where && s.gradeLevelId !== where.gradeLevelId) return false;
      if (where.deletedAt === null && s.deletedAt !== null) return false;
      const notClause = where.deletedAt as { not: null } | undefined;
      if (notClause && typeof notClause === "object" && "not" in notClause && s.deletedAt === null)
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
        const clash = termSubjects.some(
          (s) =>
            s !== m &&
            s.gradeLevelId === m.gradeLevelId &&
            s.deletedAt === null &&
            nameKey(s.name) === nameKey(newName)
        );
        if (clash) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
            code: "P2002",
            clientVersion: "test",
          });
        }
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

/**
 * `lockGrade`'s `SELECT "id" FROM "GradeLevel" ... FOR UPDATE` (result ignored
 * by the action), `reorderTermSubjects`' own `SELECT "id" FROM "TermSubject"
 * ... FOR UPDATE` (result IS the locked active-id list `planSubjectReorder`
 * compares against), and `resetSchoolTermSubjects`' `SELECT "id", "type" FROM
 * "GradeLevel" ... FOR UPDATE` (the grades it iterates) share one
 * tagged-template mock, told apart by which table/columns the SQL text names.
 */
const txQueryRaw = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const sql = strings.join(" ");
  if (sql.includes('"TermSubject"')) {
    const [gradeLevelId, schoolId] = values as [string, string];
    return termSubjects
      .filter(
        (s) =>
          s.gradeLevelId === gradeLevelId && s.schoolId === schoolId && s.deletedAt === null
      )
      .map((s) => ({ id: s.id }));
  }
  if (sql.includes('"GradeLevel"') && sql.includes('"type"')) {
    const [schoolId] = values as [string];
    return grades
      .filter((g) => g.schoolId === schoolId && g.deletedAt === null && g.type !== "FLOATING")
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((g) => ({ id: g.id, type: g.type }));
  }
  return [];
});

function makeTx() {
  return {
    $queryRaw: (...args: unknown[]) => txQueryRaw(...(args as [never])),
    gradeLevel: {
      findFirst: (...args: unknown[]) => gradeLevelFindFirst(...(args as [never])),
    },
    termSubjectDefault: {
      findMany: (...args: unknown[]) => termSubjectDefaultFindMany(...(args as [never])),
    },
    termSubject: {
      findMany: (...args: unknown[]) => termSubjectFindMany(...(args as [never])),
      createMany: (...args: unknown[]) => termSubjectCreateMany(...(args as [never])),
      create: (...args: unknown[]) => termSubjectCreate(...(args as [never])),
      updateMany: (...args: unknown[]) => termSubjectUpdateMany(...(args as [never])),
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
    gradeLevel: {
      findFirst: (...args: unknown[]) => gradeLevelFindFirst(...(args as [never])),
    },
    termSubjectDefault: {
      findMany: (...args: unknown[]) => termSubjectDefaultFindMany(...(args as [never])),
    },
    termSubject: {
      findFirst: (...args: unknown[]) => termSubjectFindFirst(...(args as [never])),
      findMany: (...args: unknown[]) => termSubjectFindMany(...(args as [never])),
      createMany: (...args: unknown[]) => termSubjectCreateMany(...(args as [never])),
      updateMany: (...args: unknown[]) => termSubjectUpdateMany(...(args as [never])),
    },
    school: {
      findFirst: (...args: unknown[]) => schoolFindFirst(...(args as [never])),
    },
  },
}));

const requireUser = vi.fn(async () => session);
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...(args as [])),
}));

const writeAudit = vi.fn(
  async (_entry: {
    userId: string;
    schoolId: string;
    action: string;
    resource: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }) => {}
);
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [never])),
  AUDIT_ACTIONS: {
    TERM_SUBJECT_CREATE: "TERM_SUBJECT_CREATE",
    TERM_SUBJECT_RENAME: "TERM_SUBJECT_RENAME",
    TERM_SUBJECT_ARCHIVE: "TERM_SUBJECT_ARCHIVE",
    TERM_SUBJECT_RESTORE: "TERM_SUBJECT_RESTORE",
    TERM_SUBJECT_REORDER: "TERM_SUBJECT_REORDER",
    TERM_SUBJECT_RESET_SCHOOL: "TERM_SUBJECT_RESET_SCHOOL",
  },
}));

const revalidateTermSubjects = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateTermSubjects: (...args: unknown[]) => revalidateTermSubjects(...(args as [])),
}));

const {
  getTermSubjects,
  createTermSubject,
  renameTermSubject,
  archiveTermSubject,
  restoreTermSubject,
  reorderTermSubjects,
  resetSchoolTermSubjects,
} = await import("@/lib/actions/term-subjects");

function subject(overrides: Partial<SubjectRow> & { id: string; name: string }): SubjectRow {
  return {
    schoolId: SCHOOL_ID,
    gradeLevelId: GRADE_ID,
    position: 0,
    deletedAt: null,
    ...overrides,
  };
}

/** Nothing in the sheet changed: no write, no audit, no cache bust. */
function expectNoWrite() {
  expect(termSubjectCreate).not.toHaveBeenCalled();
  expect(termSubjectUpdateMany).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
  expect(revalidateTermSubjects).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  nextCreatedId = 0;
  nextSeededId = 0;
  grades = [
    { id: GRADE_ID, schoolId: SCHOOL_ID, deletedAt: null, type: "G7" },
    { id: FLOATING_GRADE_ID, schoolId: SCHOOL_ID, deletedAt: null, type: "FLOATING" },
    { id: ARCHIVED_GRADE_ID, schoolId: SCHOOL_ID, deletedAt: new Date(2026, 5, 1), type: "G7" },
    { id: FOREIGN_GRADE_ID, schoolId: OTHER_SCHOOL_ID, deletedAt: null, type: "G7" },
  ];
  termSubjects = [
    subject({ id: "subject-english", name: "English", position: 0 }),
    subject({ id: "subject-math", name: "Mathematics", position: 1 }),
  ];
  // No Super Admin templates by default — the cold seed and
  // `resetSchoolTermSubjects` tests that need one set `defaultsByType` themselves.
  defaultsByType = {};
  schools = [
    { id: SCHOOL_ID, deletedAt: null },
    { id: OTHER_SCHOOL_ID, deletedAt: null },
  ];
  session = HEAD;
});

describe("getTermSubjects", () => {
  it("returns the active list (display order) and the archived list", async () => {
    termSubjects.push(
      subject({ id: "subject-archived", name: "Old", deletedAt: new Date(2026, 8, 1) })
    );

    const res = await getTermSubjects({ gradeLevelId: GRADE_ID });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.active.map((s) => s.id)).toEqual(["subject-english", "subject-math"]);
    expect(res.data.archived.map((s) => s.id)).toEqual(["subject-archived"]);
    expect(res.data.max).toBe(MAX_ACTIVE_SUBJECTS_PER_GRADE);
  });

  it("refuses a School Head's request for a grade in another school with NOT_FOUND", async () => {
    session = HEAD;

    const res = await getTermSubjects({ gradeLevelId: FOREIGN_GRADE_ID });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("lets a Super Admin load a grade outside every school of their own", async () => {
    session = ADMIN;

    const res = await getTermSubjects({ gradeLevelId: FOREIGN_GRADE_ID });

    expect(res.ok).toBe(true);
    // The admin's own (null) schoolId never entered the query.
    expect(gradeLevelFindFirst.mock.calls[0][0].where).not.toHaveProperty("schoolId");
  });

  it("refuses a FLOATING grade with VALIDATION_FAILED, not NOT_FOUND", async () => {
    const res = await getTermSubjects({ gradeLevelId: FLOATING_GRADE_ID });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.error).toContain("Floating");
  });

  it("refuses a soft-deleted grade identically to one that does not exist", async () => {
    const res = await getTermSubjects({ gradeLevelId: ARCHIVED_GRADE_ID });
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("createTermSubject — tenancy", () => {
  it("refuses a School Head creating on another school's grade: NOT_FOUND, nothing written", async () => {
    session = HEAD;

    const res = await createTermSubject({ gradeLevelId: FOREIGN_GRADE_ID, name: "New Subject" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });

  it("lets a Super Admin create on any school's grade, and audits with the TARGET row's schoolId", async () => {
    session = ADMIN;

    const res = await createTermSubject({ gradeLevelId: FOREIGN_GRADE_ID, name: "New Subject" });

    expect(res.ok).toBe(true);
    expect(termSubjectCreate).toHaveBeenCalledTimes(1);
    expect(termSubjectCreate.mock.calls[0][0].data).toMatchObject({
      schoolId: OTHER_SCHOOL_ID,
      gradeLevelId: FOREIGN_GRADE_ID,
    });

    const audit = writeAudit.mock.calls[0][0];
    expect(audit.action).toBe("TERM_SUBJECT_CREATE");
    // The target grade's own school — never the admin's (null) schoolId.
    expect(audit.schoolId).toBe(OTHER_SCHOOL_ID);
    expect(audit.metadata).toMatchObject({ actorRole: "SUPER_ADMIN" });
    expect(revalidateTermSubjects).toHaveBeenCalledTimes(1);
  });
});

describe("createTermSubject — grade liveness", () => {
  it("refuses a FLOATING grade with VALIDATION_FAILED, and writes nothing", async () => {
    const res = await createTermSubject({ gradeLevelId: FLOATING_GRADE_ID, name: "New Subject" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.error).toContain("Floating");
    expectNoWrite();
  });

  it("refuses a soft-deleted grade as NOT_FOUND, and writes nothing", async () => {
    const res = await createTermSubject({ gradeLevelId: ARCHIVED_GRADE_ID, name: "New Subject" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });
});

describe("createTermSubject — the active-name uniqueness rule", () => {
  it("refuses a duplicate name with VALIDATION_FAILED (the accepted deviation, not DB_CONFLICT)", async () => {
    const res = await createTermSubject({ gradeLevelId: GRADE_ID, name: "english" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.fieldErrors?.name).toBeTruthy();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(revalidateTermSubjects).not.toHaveBeenCalled();
  });

  it("is case- and whitespace-insensitive, matching the SQL partial unique index", async () => {
    const res = await createTermSubject({ gradeLevelId: GRADE_ID, name: "  ENGLISH  " });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });

  it("allows the same name on a DIFFERENT grade", async () => {
    termSubjects.push(subject({ id: "other-grade-math", gradeLevelId: FLOATING_GRADE_ID, name: "Mathematics" }));
    // FLOATING_GRADE_ID itself refuses subjects, so prove the name-scoping some
    // other way: two live grades sharing a name must both succeed.
    grades.push({ id: "grade-g8", schoolId: SCHOOL_ID, deletedAt: null, type: "G8" });

    const res = await createTermSubject({ gradeLevelId: "grade-g8", name: "Mathematics" });
    expect(res.ok).toBe(true);
  });

  it("allows re-creating a name an archived row still holds", async () => {
    termSubjects[1].deletedAt = new Date(2026, 8, 1); // archive "Mathematics"

    const res = await createTermSubject({ gradeLevelId: GRADE_ID, name: "Mathematics" });
    expect(res.ok).toBe(true);
  });
});

describe("createTermSubject — the 15-subject cap", () => {
  it("refuses the 16th active subject with VALIDATION_FAILED", async () => {
    termSubjects = Array.from({ length: MAX_ACTIVE_SUBJECTS_PER_GRADE }, (_, i) =>
      subject({ id: `subject-${i}`, name: `Subject ${i}`, position: i })
    );

    const res = await createTermSubject({ gradeLevelId: GRADE_ID, name: "One Too Many" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.error).toContain(`${MAX_ACTIVE_SUBJECTS_PER_GRADE}`);
    expectNoWrite();
  });

  it("accepts exactly the 15th", async () => {
    termSubjects = Array.from({ length: MAX_ACTIVE_SUBJECTS_PER_GRADE - 1 }, (_, i) =>
      subject({ id: `subject-${i}`, name: `Subject ${i}`, position: i })
    );

    const res = await createTermSubject({ gradeLevelId: GRADE_ID, name: "The 15th" });
    expect(res.ok).toBe(true);
  });

  it("does not count an archived subject toward the cap", async () => {
    termSubjects = Array.from({ length: MAX_ACTIVE_SUBJECTS_PER_GRADE }, (_, i) =>
      subject({ id: `subject-${i}`, name: `Subject ${i}`, position: i })
    );
    // Archive one, freeing a slot.
    termSubjects[0].deletedAt = new Date(2026, 8, 1);

    const res = await createTermSubject({ gradeLevelId: GRADE_ID, name: "Freed Slot" });
    expect(res.ok).toBe(true);
  });
});

describe("renameTermSubject", () => {
  it("refuses a School Head renaming a subject in another school: NOT_FOUND", async () => {
    termSubjects.push(subject({ id: "foreign-subj", schoolId: OTHER_SCHOOL_ID, gradeLevelId: FOREIGN_GRADE_ID, name: "Foreign" }));

    const res = await renameTermSubject({ id: "foreign-subj", name: "Renamed" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });

  it("lets a Super Admin rename a subject in any school, audited with the subject's OWN school", async () => {
    termSubjects.push(subject({ id: "foreign-subj", schoolId: OTHER_SCHOOL_ID, gradeLevelId: FOREIGN_GRADE_ID, name: "Foreign" }));
    session = ADMIN;

    const res = await renameTermSubject({ id: "foreign-subj", name: "Renamed" });

    expect(res.ok).toBe(true);
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.action).toBe("TERM_SUBJECT_RENAME");
    expect(audit.schoolId).toBe(OTHER_SCHOOL_ID);
    expect(audit.metadata).toMatchObject({ oldName: "Foreign", newName: "Renamed" });
  });

  it("refuses an already-archived subject as NOT_FOUND", async () => {
    termSubjects.push(subject({ id: "archived-subj", name: "Archived", deletedAt: new Date(2026, 8, 1) }));

    const res = await renameTermSubject({ id: "archived-subj", name: "Renamed" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });

  it("refuses a subject on a FLOATING grade with VALIDATION_FAILED", async () => {
    termSubjects.push(subject({ id: "floating-subj", gradeLevelId: FLOATING_GRADE_ID, name: "Stray" }));

    const res = await renameTermSubject({ id: "floating-subj", name: "Renamed" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });

  it("refuses renaming into another active subject's name on the same grade", async () => {
    const res = await renameTermSubject({ id: "subject-math", name: "English" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.fieldErrors?.name).toBeTruthy();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("is a no-op write that still audits when the name is unchanged", async () => {
    const res = await renameTermSubject({ id: "subject-english", name: "English" });

    expect(res.ok).toBe(true);
    expect(termSubjectUpdateMany).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledTimes(1);
  });
});

describe("archiveTermSubject", () => {
  it("refuses a School Head archiving another school's subject: NOT_FOUND", async () => {
    termSubjects.push(subject({ id: "foreign-subj", schoolId: OTHER_SCHOOL_ID, gradeLevelId: FOREIGN_GRADE_ID, name: "Foreign" }));

    const res = await archiveTermSubject({ id: "foreign-subj" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });

  it("lets a Super Admin archive a subject in any school, audited with the subject's OWN school", async () => {
    termSubjects.push(subject({ id: "foreign-subj", schoolId: OTHER_SCHOOL_ID, gradeLevelId: FOREIGN_GRADE_ID, name: "Foreign" }));
    session = ADMIN;

    const res = await archiveTermSubject({ id: "foreign-subj" });

    expect(res.ok).toBe(true);
    expect(termSubjects.find((s) => s.id === "foreign-subj")?.deletedAt).toBeInstanceOf(Date);
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.action).toBe("TERM_SUBJECT_ARCHIVE");
    expect(audit.schoolId).toBe(OTHER_SCHOOL_ID);
    expect(revalidateTermSubjects).toHaveBeenCalledTimes(1);
  });

  it("refuses archiving an already-archived subject as NOT_FOUND", async () => {
    termSubjects.push(subject({ id: "archived-subj", name: "Archived", deletedAt: new Date(2026, 8, 1) }));

    const res = await archiveTermSubject({ id: "archived-subj" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });

  it("refuses a subject on a FLOATING grade with VALIDATION_FAILED", async () => {
    termSubjects.push(subject({ id: "floating-subj", gradeLevelId: FLOATING_GRADE_ID, name: "Stray" }));

    const res = await archiveTermSubject({ id: "floating-subj" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
  });
});

describe("restoreTermSubject", () => {
  it("refuses a School Head restoring another school's subject: NOT_FOUND", async () => {
    termSubjects.push(
      subject({
        id: "foreign-subj",
        schoolId: OTHER_SCHOOL_ID,
        gradeLevelId: FOREIGN_GRADE_ID,
        name: "Foreign",
        deletedAt: new Date(2026, 8, 1),
      })
    );

    const res = await restoreTermSubject({ id: "foreign-subj" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });

  it("lets a Super Admin restore a subject in any school, audited with the subject's OWN school", async () => {
    termSubjects.push(
      subject({
        id: "foreign-subj",
        schoolId: OTHER_SCHOOL_ID,
        gradeLevelId: FOREIGN_GRADE_ID,
        name: "Foreign",
        deletedAt: new Date(2026, 8, 1),
      })
    );
    session = ADMIN;

    const res = await restoreTermSubject({ id: "foreign-subj" });

    expect(res.ok).toBe(true);
    expect(termSubjects.find((s) => s.id === "foreign-subj")?.deletedAt).toBeNull();
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.action).toBe("TERM_SUBJECT_RESTORE");
    expect(audit.schoolId).toBe(OTHER_SCHOOL_ID);
  });

  it("refuses restoring an already-active subject as NOT_FOUND", async () => {
    const res = await restoreTermSubject({ id: "subject-english" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });

  it("refuses a restore that would collide with an active subject's name", async () => {
    // An archived "English" would clash with the currently-active one.
    termSubjects.push(
      subject({ id: "archived-english", name: "English", deletedAt: new Date(2026, 8, 1) })
    );

    const res = await restoreTermSubject({ id: "archived-english" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.fieldErrors?.name).toBeTruthy();
    expect(writeAudit).not.toHaveBeenCalled();
    // Nothing actually flipped back to active.
    expect(termSubjects.find((s) => s.id === "archived-english")?.deletedAt).not.toBeNull();
  });

  it("refuses restoring into a grade already at the 15-subject cap", async () => {
    termSubjects = Array.from({ length: MAX_ACTIVE_SUBJECTS_PER_GRADE }, (_, i) =>
      subject({ id: `subject-${i}`, name: `Subject ${i}`, position: i })
    );
    termSubjects.push(
      subject({ id: "archived-extra", name: "Extra", deletedAt: new Date(2026, 8, 1) })
    );

    const res = await restoreTermSubject({ id: "archived-extra" });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.error).toContain(`${MAX_ACTIVE_SUBJECTS_PER_GRADE}`);
    expect(termSubjects.find((s) => s.id === "archived-extra")?.deletedAt).not.toBeNull();
  });

  it("places a restored subject after every currently-active one", async () => {
    termSubjects.push(
      subject({ id: "archived-reading", name: "Reading Club", position: 5, deletedAt: new Date(2026, 8, 1) })
    );

    const res = await restoreTermSubject({ id: "archived-reading" });

    expect(res.ok).toBe(true);
    const restored = termSubjects.find((s) => s.id === "archived-reading")!;
    expect(restored.deletedAt).toBeNull();
    // Active positions were 0 (English) and 1 (Mathematics) — next is 2.
    expect(restored.position).toBe(2);
  });
});

describe("reorderTermSubjects", () => {
  it("refuses a School Head reordering another school's grade: NOT_FOUND", async () => {
    const res = await reorderTermSubjects({
      gradeLevelId: FOREIGN_GRADE_ID,
      orderedIds: ["subject-english"],
    });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expectNoWrite();
  });

  it("lets a Super Admin reorder any school's grade, audited with the grade's OWN school", async () => {
    session = ADMIN;
    termSubjects.push(subject({ id: "foreign-a", schoolId: OTHER_SCHOOL_ID, gradeLevelId: FOREIGN_GRADE_ID, name: "A", position: 0 }));
    termSubjects.push(subject({ id: "foreign-b", schoolId: OTHER_SCHOOL_ID, gradeLevelId: FOREIGN_GRADE_ID, name: "B", position: 1 }));

    const res = await reorderTermSubjects({
      gradeLevelId: FOREIGN_GRADE_ID,
      orderedIds: ["foreign-b", "foreign-a"],
    });

    expect(res.ok).toBe(true);
    expect(termSubjects.find((s) => s.id === "foreign-b")!.position).toBe(0);
    expect(termSubjects.find((s) => s.id === "foreign-a")!.position).toBe(1);
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.action).toBe("TERM_SUBJECT_REORDER");
    expect(audit.schoolId).toBe(OTHER_SCHOOL_ID);
  });

  it("reorders active subjects into the posted order", async () => {
    const res = await reorderTermSubjects({
      gradeLevelId: GRADE_ID,
      orderedIds: ["subject-math", "subject-english"],
    });

    expect(res.ok).toBe(true);
    expect(termSubjects.find((s) => s.id === "subject-math")!.position).toBe(0);
    expect(termSubjects.find((s) => s.id === "subject-english")!.position).toBe(1);
    expect(revalidateTermSubjects).toHaveBeenCalledTimes(1);
  });

  it("refuses a stale reorder (an id missing from the current active set) with VALIDATION_FAILED, not DB_CONFLICT", async () => {
    // The client's list is out of date: it posts an id that is no longer active
    // (archived by someone else between load and submit).
    const res = await reorderTermSubjects({
      gradeLevelId: GRADE_ID,
      orderedIds: ["subject-english", "subject-does-not-exist"],
    });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.error).toContain("Reload");
    // Nothing was repositioned.
    expect(termSubjects.find((s) => s.id === "subject-english")!.position).toBe(0);
    expect(writeAudit).not.toHaveBeenCalled();
    expect(revalidateTermSubjects).not.toHaveBeenCalled();
  });

  it("refuses a reorder missing a currently-active id, same STALE path", async () => {
    const res = await reorderTermSubjects({
      gradeLevelId: GRADE_ID,
      orderedIds: ["subject-english"], // subject-math is active but omitted
    });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses a reorder that repeats an id, with VALIDATION_FAILED", async () => {
    const res = await reorderTermSubjects({
      gradeLevelId: GRADE_ID,
      orderedIds: ["subject-english", "subject-english"],
    });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses reordering a FLOATING grade with VALIDATION_FAILED", async () => {
    const res = await reorderTermSubjects({
      gradeLevelId: FLOATING_GRADE_ID,
      orderedIds: ["subject-english"],
    });

    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    if (res.ok) return;
    expect(res.error).toContain("Floating");
  });
});

describe("resetSchoolTermSubjects", () => {
  it("ignores a School Head's posted schoolId — always resets the caller's OWN school", async () => {
    session = HEAD;
    // FLOATING and the soft-deleted grade must never be touched, and neither
    // must the OTHER school's grade this payload tries to point at.
    const res = await resetSchoolTermSubjects({ schoolId: OTHER_SCHOOL_ID });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Only SCHOOL_ID's own live, non-FLOATING grade (GRADE_ID) was processed.
    expect(res.data.grades).toBe(1);
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.schoolId).toBe(SCHOOL_ID);
  });

  it("honours a Super Admin's posted schoolId", async () => {
    session = ADMIN;

    const res = await resetSchoolTermSubjects({ schoolId: OTHER_SCHOOL_ID });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.grades).toBe(1); // FOREIGN_GRADE_ID, OTHER_SCHOOL_ID's only live non-FLOATING grade
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.schoolId).toBe(OTHER_SCHOOL_ID);
    expect(audit.action).toBe("TERM_SUBJECT_RESET_SCHOOL");
  });

  it("refuses a missing school (Super Admin) as NOT_FOUND, writing nothing", async () => {
    session = ADMIN;

    const res = await resetSchoolTermSubjects({ schoolId: "school-does-not-exist" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(writeAudit).not.toHaveBeenCalled();
    expect(revalidateTermSubjects).not.toHaveBeenCalled();
  });

  it("refuses a soft-deleted school (Super Admin) as NOT_FOUND, writing nothing", async () => {
    session = ADMIN;
    schools.push({ id: "school-removed", deletedAt: new Date(2026, 8, 1) });

    const res = await resetSchoolTermSubjects({ schoolId: "school-removed" });

    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("restores an archived subject that matches a default, keeping its own id", async () => {
    termSubjects = [
      subject({ id: "subject-english", name: "English", position: 0 }),
      subject({
        id: "archived-science",
        name: "Science",
        position: 5,
        deletedAt: new Date(2026, 8, 1),
      }),
    ];
    defaultsByType["G7"] = [
      { id: "d-english", name: "English", position: 0, deletedAt: null },
      { id: "d-science", name: "Science", position: 1, deletedAt: null },
    ];

    const res = await resetSchoolTermSubjects({});

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({ grades: 1, created: 0, restored: 1, archived: 0 });
    const restored = termSubjects.find((s) => s.id === "archived-science")!;
    expect(restored.deletedAt).toBeNull();
    expect(restored.position).toBe(1);
  });

  it("archives an active subject matching no default, scoped by schoolId in the where", async () => {
    termSubjects = [subject({ id: "subject-custom", name: "Custom Subject", position: 0 })];
    defaultsByType["G7"] = [];

    const res = await resetSchoolTermSubjects({});

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toMatchObject({ grades: 1, created: 0, restored: 0, archived: 1 });
    expect(termSubjects.find((s) => s.id === "subject-custom")!.deletedAt).toBeInstanceOf(Date);

    const archiveCall = termSubjectUpdateMany.mock.calls.find(
      (c) => (c[0].where as { id?: { in?: string[] } }).id?.in?.includes("subject-custom")
    );
    expect(archiveCall).toBeTruthy();
    expect(archiveCall![0].where).toMatchObject({ schoolId: SCHOOL_ID });
  });

  it("returns tallies across create, reposition and archive together", async () => {
    // Existing: English (active, matches), Mathematics (active, unmatched).
    // Defaults: English (matches active), Science (matches nothing → create).
    defaultsByType["G7"] = [
      { id: "d-english", name: "English", position: 0, deletedAt: null },
      { id: "d-science", name: "Science", position: 1, deletedAt: null },
    ];

    const res = await resetSchoolTermSubjects({});

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual({ grades: 1, created: 1, restored: 0, archived: 1 });
  });

  it("writes one audit row carrying the tallies", async () => {
    defaultsByType["G7"] = [
      { id: "d-english", name: "English", position: 0, deletedAt: null },
    ];

    const res = await resetSchoolTermSubjects({});

    expect(res.ok).toBe(true);
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.action).toBe("TERM_SUBJECT_RESET_SCHOOL");
    expect(audit.resource).toBe("School");
    expect(audit.resourceId).toBe(SCHOOL_ID);
    expect(audit.metadata).toMatchObject({ grades: 1, actorRole: "SCHOOL_HEAD" });
    expect(revalidateTermSubjects).toHaveBeenCalledTimes(1);
  });
});
