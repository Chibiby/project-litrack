import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CellValue, Workbook, Worksheet } from "exceljs";
import { formatLocalDateKey, schoolToday } from "@/lib/date-keys";
import { getTermWindows, isTermLocked } from "@/lib/terms/windows";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

/**
 * Action-level coverage for `exportTermGrades` — the read half of the End of Terms
 * Reports feature, and the half `tests/unit/actions/term-grades-save.test.ts` does
 * not touch.
 *
 * Same harness shape, fixtures and fake-clock as the save suite on purpose: one
 * mental model for one module. What is DIFFERENT about export, and therefore what
 * this file exists to pin:
 *
 *   - It guards with `requireUser("TEACHER")`, not `requireSchoolUser`. A Super
 *     Admin holds no `schoolId`, and admins are entitled to export, so the school
 *     is DERIVED from the posted `gradeLevelId` in that branch instead of coming
 *     from the session.
 *   - There is deliberately NO lock check. Viewing and exporting survive a closed
 *     term; only encoding stops. Nothing else in the codebase asserts that, so a
 *     regression that "helpfully" added the save action's lock check here would
 *     otherwise ship silently.
 *   - The teacher branch PINS `sectionId` to the advisory section and ignores the
 *     posted `?section=` entirely. The export payload carries `section` because the
 *     Super Admin branch honours it; a teacher's cannot widen or redirect the
 *     roster. That divergence is asserted against the `where` the action actually
 *     hands Prisma, not merely against a successful result.
 *   - `termGrade.findMany` reuses the SAME roster `where` object as the learner
 *     query, so roster and cell tenancy cannot drift. `TermGrade` carries no
 *     `schoolId` column, so that nested clause is the whole tenant boundary for the
 *     exported cells.
 *
 * Only leaf infrastructure is mocked (Prisma client, session, audit, cache). The
 * real Zod schema, the real `getAdvisoryPlacement`, the real `deniesAdvisoryRoster`,
 * the real term-window maths, the real `generalAverage` and the real exceljs all
 * run — the workbook these tests read back is the bytes a teacher would download.
 *
 * ONE deviation from the save suite, and the reason for it: the fake clock is
 * installed as `vi.useFakeTimers({ toFake: ["Date"] })` rather than bare
 * `useFakeTimers()`. Vitest's default set also fakes `setImmediate`, which exceljs's
 * zip writer flushes its streams through — with it faked, `wb.xlsx.writeBuffer()`
 * never resolves and every export test times out. `Date` is the only clock this
 * action reads, so narrowing the set costs nothing and keeps real exceljs in play.
 */

const TEACHER_ID = "teacher-marivic";
const ADMIN_ID = "admin-super";
const SCHOOL_ID = "school-malandag";
const OTHER_SCHOOL_ID = "school-kiblawan";
const SECTION_ID = "section-sampaguita";
const OTHER_SECTION_ID = "section-rosal";
const GRADE_ID = "grade-g7";
const OTHER_GRADE_ID = "grade-g8";
/** A real grade, in a school the teacher does not belong to. */
const FOREIGN_GRADE_ID = "grade-kiblawan-g7";
const SCHOOL_YEAR_ID = "sy-2026-2027";
const SCHOOL_YEAR_LABEL = "2026-2027";

/**
 * The save suite's clock, unchanged. December 15 2026 at LOCAL noon — built from
 * local fields, never a UTC instant, and deliberately mid-day: this box is UTC+8
 * and CI is UTC, and both must resolve `schoolToday()` to the same civil day or the
 * exported filename and the set of locked terms change between the two.
 */
const TODAY = new Date(2026, 11, 15, 12, 0, 0);
/** August 1 2026 — the approved sheet's calendar. Local midnight, no UTC instant. */
const SCHOOL_YEAR_START = new Date(2026, 7, 1);
/** The civil day `TODAY` must resolve to in every timezone this suite runs in. */
const TODAY_KEY = "2026-12-15";
/** Open on `TODAY`. */
const OPEN_TERM = "SECOND";
/** Closed on `TODAY` — and still exportable, which is the point. */
const LOCKED_TERM = "FIRST";

/**
 * The approved sheet's eight learning areas, in column order, hardcoded rather
 * than imported from `LEARNING_AREA_ORDER`.
 *
 * Deliberate: the design fixes this workbook to the JHS 8 for every grade, so a
 * ninth area appearing in the enum should fail this file loudly rather than be
 * absorbed into it.
 */
const LEARNING_AREAS = [
  "ENGLISH",
  "FILIPINO",
  "MATHEMATICS",
  "SCIENCE",
  "ARALING_PANLIPUNAN",
  "EDUKASYON_SA_PAGPAPAKATAO",
  "MAPEH",
  "TLE",
] as const;

type LearningArea = (typeof LEARNING_AREAS)[number];

const HEADER_ROW = [
  "#",
  "Complete Name",
  "English",
  "Filipino",
  "Mathematics",
  "Science",
  "Araling Panlipunan",
  "Edukasyon sa Pagpapakatao",
  "MAPEH",
  "TLE",
  "General Average",
];

/** `#` + name + eight areas + general average. */
const SHEET_WIDTH = HEADER_ROW.length;

type LearnerRow = {
  id: string;
  fullName: string;
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

type GradeRow = {
  id: string;
  schoolId: string;
  deletedAt: Date | null;
};

type SchoolYearRow = {
  id: string;
  label: string;
  schoolId: string;
  isActive: boolean;
  startDate: Date;
};

type CellRow = {
  learnerId: string;
  schoolYearId: string;
  term: string;
  subject: LearningArea;
  score: number;
};

let learners: LearnerRow[];
let sections: SectionRow[];
let grades: GradeRow[];
let schoolYears: SchoolYearRow[];
let cells: CellRow[];
/** `TeacherProfile.designation` for the caller; `null` is an ordinary DepEd teacher. */
let designation: string | null;
/** What `requireUser` resolves. `schoolId` is nullable here — that is the point. */
let session: {
  id: string;
  schoolId: string | null;
  role: "TEACHER" | "SUPER_ADMIN";
  advisorySectionId: string | null;
};

/** Every `where`/`orderBy` the action read the roster with. */
let learnerFindManyArgs: {
  where: Record<string, unknown>;
  orderBy?: Record<string, unknown>;
}[];
/** Every `where` the action read the term cells with. */
let cellFindManyArgs: { where: Record<string, unknown> }[];

function learner(overrides: Partial<LearnerRow> & { id: string; fullName: string }): LearnerRow {
  return {
    schoolId: SCHOOL_ID,
    gradeLevelId: GRADE_ID,
    sectionId: SECTION_ID,
    deletedAt: null,
    archivedAt: null,
    ...overrides,
  };
}

function cell(overrides: Partial<CellRow> & { learnerId: string; subject: LearningArea; score: number }): CellRow {
  return {
    schoolYearId: SCHOOL_YEAR_ID,
    term: OPEN_TERM,
    ...overrides,
  };
}

/**
 * Clauses the roster `where` is allowed to contain. A new one must be taught to
 * `learnerMatches` before these tests can be trusted: silently ignoring an unknown
 * filter would make every assertion below weaker than it looks.
 */
const KNOWN_ROSTER_CLAUSES = new Set([
  "schoolId",
  "gradeLevelId",
  "sectionId",
  "deletedAt",
  "archivedAt",
  "fullName",
]);

/**
 * Honours exactly the clauses the action supplies and no more.
 *
 * The load-bearing property of the whole file. Every clause is tested with `in`
 * rather than hardcoded, so deleting `schoolId` or `sectionId` from the action's
 * `where` stops the foreign fixture rows being filtered HERE too — and the
 * isolation tests below go red, which is the direction a fake must fail in. A fake
 * that applied the filters unconditionally would keep passing after the real ones
 * were removed.
 */
function learnerMatches(row: LearnerRow, where: Record<string, unknown>): boolean {
  for (const clause of Object.keys(where)) {
    if (!KNOWN_ROSTER_CLAUSES.has(clause)) {
      throw new Error(
        `unhandled roster clause "${clause}" — teach learnerMatches about it before trusting this suite`
      );
    }
  }
  if ("schoolId" in where && row.schoolId !== where.schoolId) return false;
  if ("gradeLevelId" in where && row.gradeLevelId !== where.gradeLevelId) return false;
  if ("sectionId" in where && row.sectionId !== where.sectionId) return false;
  if (where.deletedAt === null && row.deletedAt !== null) return false;
  if (where.archivedAt === null && row.archivedAt !== null) return false;

  const name = where.fullName as { contains: string; mode?: string } | undefined;
  if (name) {
    // Case folding only when the action asks for it, so dropping `mode` fails the
    // search test instead of passing by accident.
    const insensitive = name.mode === "insensitive";
    const haystack = insensitive ? row.fullName.toLowerCase() : row.fullName;
    const needle = insensitive ? name.contains.toLowerCase() : name.contains;
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

const learnerFindMany = vi.fn(
  async (args: {
    where: Record<string, unknown>;
    orderBy?: { fullName?: "asc" | "desc" };
  }) => {
    learnerFindManyArgs.push(args);
    const matched = learners.filter((l) => learnerMatches(l, args.where));
    // Honoured, not assumed: the fixtures are inserted out of alphabetical order,
    // so a dropped `orderBy` shows up as a reordered workbook.
    if (args.orderBy?.fullName === "asc") {
      matched.sort((a, b) => a.fullName.localeCompare(b.fullName));
    }
    return matched.map((l) => ({ id: l.id, fullName: l.fullName }));
  }
);

/**
 * Backs the cell read. The nested `learner` clause is resolved against the same
 * learner table through the same matcher, so if the action ever stopped passing
 * `learner: rosterWhere` the foreign and out-of-section cells would start being
 * counted and the audit `cellCount` assertions would fail.
 */
const cellFindMany = vi.fn(async (args: { where: Record<string, unknown> }) => {
  cellFindManyArgs.push(args);
  const where = args.where;
  const rosterWhere = where.learner as Record<string, unknown> | undefined;
  return cells
    .filter((c) => {
      if ("schoolYearId" in where && c.schoolYearId !== where.schoolYearId) return false;
      if ("term" in where && c.term !== where.term) return false;
      if (rosterWhere) {
        const row = learners.find((l) => l.id === c.learnerId);
        if (!row || !learnerMatches(row, rosterWhere)) return false;
      }
      return true;
    })
    .map((c) => ({ learnerId: c.learnerId, subject: c.subject, score: c.score }));
});

/** Backs the real `getAdvisoryPlacement`, tenant filter and soft delete included. */
const sectionFindFirst = vi.fn(
  async (args: { where: { id: string; schoolId?: string; deletedAt?: Date | null } }) => {
    const found = sections.find((s) => {
      if (s.id !== args.where.id) return false;
      if ("schoolId" in args.where && s.schoolId !== args.where.schoolId) return false;
      if (args.where.deletedAt === null && s.deletedAt !== null) return false;
      return true;
    });
    if (!found) return null;
    return {
      id: found.id,
      name: found.name,
      gradeLevelId: found.gradeLevelId,
      gradeLevel: { type: found.gradeType },
    };
  }
);

/** The Super Admin branch's only source of `schoolId`. */
const gradeLevelFindFirst = vi.fn(
  async (args: { where: { id: string; deletedAt?: Date | null } }) => {
    const found = grades.find((g) => {
      if (g.id !== args.where.id) return false;
      // Absent clause means no filtering, so dropping `deletedAt: null` lets the
      // soft-deleted grade through here and fails its test.
      if (args.where.deletedAt === null && g.deletedAt !== null) return false;
      return true;
    });
    return found ? { id: found.id, schoolId: found.schoolId } : null;
  }
);

/** `TeacherProfile` carries no `schoolId`, so the tenant rides the user relation. */
const teacherProfileFindFirst = vi.fn(
  async (args: { where: { userId: string; user?: { schoolId: string } } }) => {
    if (args.where.userId !== session.id) return null;
    if (args.where.user && args.where.user.schoolId !== session.schoolId) return null;
    return { designation };
  }
);

const schoolYearFindFirst = vi.fn(
  async (args: { where: { schoolId?: string; isActive?: boolean } }) => {
    const found = schoolYears.find((y) => {
      if ("schoolId" in args.where && y.schoolId !== args.where.schoolId) return false;
      if ("isActive" in args.where && y.isActive !== args.where.isActive) return false;
      return true;
    });
    return found
      ? { id: found.id, label: found.label, startDate: found.startDate }
      : null;
  }
);

/**
 * The write surface of the module. Export must never touch it — an export is a
 * read, and these are here so "wrote nothing" is asserted rather than assumed.
 */
const termGradeUpsert = vi.fn((args: unknown) => ({ op: "upsert", args }));
const termGradeDeleteMany = vi.fn((args: unknown) => ({ op: "deleteMany", args }));
const transaction = vi.fn(async (ops: unknown[]) => ops);

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
    gradeLevel: {
      findFirst: (...args: unknown[]) => gradeLevelFindFirst(...(args as [never])),
    },
    teacherProfile: {
      findFirst: (...args: unknown[]) => teacherProfileFindFirst(...(args as [never])),
    },
    schoolYear: {
      findFirst: (...args: unknown[]) => schoolYearFindFirst(...(args as [never])),
    },
    termGrade: {
      findMany: (...args: unknown[]) => cellFindMany(...(args as [never])),
      upsert: (...args: unknown[]) => termGradeUpsert(...(args as [never])),
      deleteMany: (...args: unknown[]) => termGradeDeleteMany(...(args as [never])),
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
    userId: string;
    schoolId: string;
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
const { exportTermGrades } = await import("@/lib/actions/term-grades");

type ExportResult = Awaited<ReturnType<typeof exportTermGrades>>;

function post(
  overrides: {
    gradeLevelId?: string;
    term?: string;
    section?: string;
    q?: string;
  } = {}
): Promise<ExportResult> {
  return exportTermGrades({
    gradeLevelId: GRADE_ID,
    term: OPEN_TERM,
    ...overrides,
  });
}

/** Asserts success and narrows, so a refusal reports its own message. */
function fileOf(res: ExportResult): { filename: string; base64: string } {
  if (!res.ok) throw new Error(`expected a workbook, got refusal: ${res.error}`);
  if (!res.data) throw new Error("expected a workbook, got ok with no data");
  return res.data;
}

/** Asserts refusal and narrows. */
function errorOf(res: ExportResult): string {
  if (res.ok) throw new Error("expected a refusal, got a workbook");
  return res.error;
}

/** An export changes nothing: no writes, no transaction, no cache busting. */
function expectReadOnly() {
  expect(transaction).not.toHaveBeenCalled();
  expect(termGradeUpsert).not.toHaveBeenCalled();
  expect(termGradeDeleteMany).not.toHaveBeenCalled();
  expect(revalidatePath).not.toHaveBeenCalled();
  expect(revalidateLearnerScoped).not.toHaveBeenCalled();
}

/** Every refusal happens before any data is read, and logs nothing. */
function expectRefusedBeforeReading() {
  expect(learnerFindMany).not.toHaveBeenCalled();
  expect(cellFindMany).not.toHaveBeenCalled();
  expect(writeAudit).not.toHaveBeenCalled();
  expectReadOnly();
}

type Cell = string | number | null;

/** A blank cell and an empty-string cell mean the same thing: not encoded. */
function normalize(value: CellValue): Cell {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return JSON.stringify(value);
}

function grid(sheet: Worksheet, width: number): Cell[][] {
  const rows: Cell[][] = [];
  for (let r = 1; r <= sheet.rowCount; r += 1) {
    const row = sheet.getRow(r);
    rows.push(
      Array.from({ length: width }, (_, i) => normalize(row.getCell(i + 1).value))
    );
  }
  return rows;
}

/**
 * What `Xlsx.load` will accept, according to exceljs.
 *
 * exceljs's declarations open with `declare interface Buffer extends ArrayBuffer {}`
 * (`node_modules/exceljs/index.d.ts:1`), which merges into Node's global `Buffer`
 * and leaves `Buffer.from(...)` — a `Buffer<ArrayBuffer>` — unassignable to the very
 * parameter `load()` asks for. An upstream wart, not ours; the single cast it forces
 * is confined to the helper below rather than sprinkled through the assertions.
 */
type ExcelLoadable = Parameters<Workbook["xlsx"]["load"]>[0];

/** Unzips the bytes the action actually returned. Real exceljs, both directions. */
async function readExport(base64: string): Promise<{
  sheetNames: string[];
  rows: Cell[][];
  info: Cell[][];
}> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(base64, "base64") as unknown as ExcelLoadable);
  const [main, info] = wb.worksheets;
  return {
    sheetNames: wb.worksheets.map((s) => s.name),
    rows: grid(main, SHEET_WIDTH),
    info: grid(info, 2),
  };
}

/** One expected sheet row, in the approved column order. */
function expectedRow(
  index: number,
  fullName: string,
  scores: Partial<Record<LearningArea, number>>,
  average: number | null
): Cell[] {
  return [index, fullName, ...LEARNING_AREAS.map((a) => scores[a] ?? null), average];
}

function asSuperAdmin(schoolId: string | null = null) {
  session = {
    id: ADMIN_ID,
    schoolId,
    role: "SUPER_ADMIN",
    advisorySectionId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // `Date` only — see the file header. Faking `setImmediate` deadlocks exceljs.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TODAY);

  // Inserted out of alphabetical order on purpose, so the workbook's row order
  // proves the action asked Prisma to sort.
  learners = [
    learner({ id: "learner-zeny", fullName: "Zabala, Zeny" }),
    learner({ id: "learner-ana", fullName: "Abad, Ana" }),
  ];
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
  grades = [{ id: GRADE_ID, schoolId: SCHOOL_ID, deletedAt: null }];
  schoolYears = [
    {
      id: SCHOOL_YEAR_ID,
      label: SCHOOL_YEAR_LABEL,
      schoolId: SCHOOL_ID,
      isActive: true,
      startDate: SCHOOL_YEAR_START,
    },
  ];
  // Distinctive two-digit scores that appear in no id, count or label in the audit
  // row — so `not.toContain` on the serialized metadata cannot pass by luck.
  cells = [
    cell({ learnerId: "learner-ana", subject: "ENGLISH", score: 87 }),
    cell({ learnerId: "learner-ana", subject: "MATHEMATICS", score: 93 }),
    cell({ learnerId: "learner-zeny", subject: "ENGLISH", score: 64 }),
  ];
  designation = null;
  session = {
    id: TEACHER_ID,
    schoolId: SCHOOL_ID,
    role: "TEACHER",
    advisorySectionId: SECTION_ID,
  };
  learnerFindManyArgs = [];
  cellFindManyArgs = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("exportTermGrades — the fixture clock", () => {
  it("resolves one civil day under UTC and UTC+8, with First shut and Second open", () => {
    // Guards the filename assertions and the locked-term case. Stated once, loudly,
    // instead of being assumed a dozen times: if `schoolToday()` ever resolved to a
    // different civil day here than in CI, both would flip silently.
    expect(formatLocalDateKey(schoolToday())).toBe(TODAY_KEY);

    const [first, second, third] = getTermWindows(SCHOOL_YEAR_START);
    expect(first.term).toBe(LOCKED_TERM);
    expect(second.term).toBe(OPEN_TERM);
    expect(isTermLocked(first, TODAY_KEY)).toBe(true);
    expect(isTermLocked(second, TODAY_KEY)).toBe(false);
    expect(isTermLocked(third, TODAY_KEY)).toBe(false);
    // Anchors the "Export info" sheet assertions below.
    expect(first.rangeLabel).toBe("August - October");
    expect(second.rangeLabel).toBe("November - January");
  });
});

describe("exportTermGrades — a teacher's own advisory sheet", () => {
  it("returns the advisory roster as a workbook, name-ordered, with averages", async () => {
    // The control every refusal below is measured against. Without it, "read
    // nothing" could be vacuously true because the harness never reaches the read.
    const res = await post();
    const file = fileOf(res);

    expect(requireUser).toHaveBeenCalledWith("TEACHER");
    expect(file.filename).toBe(`litrack-term-grades-second-${TODAY_KEY}.xlsx`);

    const { sheetNames, rows, info } = await readExport(file.base64);
    expect(sheetNames).toEqual(["Second Term", "Export info"]);
    expect(rows).toEqual([
      HEADER_ROW,
      // Abad before Zabala, though Zabala was inserted first.
      expectedRow(1, "Abad, Ana", { ENGLISH: 87, MATHEMATICS: 93 }, 90),
      // A blank area is "not encoded", not a zero — a single 64 averages to 64.
      expectedRow(2, "Zabala, Zeny", { ENGLISH: 64 }, 64),
    ]);
    expect(info).toEqual([
      ["School year", SCHOOL_YEAR_LABEL],
      ["Term", "Second Term"],
      ["Months", "November - January"],
      ["Learner count", 2],
    ]);

    expectReadOnly();
  });

  it("reads the roster through the school, the advisory grade AND the advisory section", async () => {
    await post();

    // The mechanism the isolation cases depend on, asserted directly so a deleted
    // clause fails here as well as through its consequences. Exact, so a new
    // filter cannot appear unnoticed.
    expect(learnerFindManyArgs).toHaveLength(1);
    expect(learnerFindManyArgs[0].where).toEqual({
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      sectionId: SECTION_ID,
      deletedAt: null,
      archivedAt: null,
    });
    expect(learnerFindManyArgs[0].orderBy).toEqual({ fullName: "asc" });
  });

  it("keys the cells to the SAME roster clause, so the two cannot drift", async () => {
    await post();

    // `TermGrade` has no `schoolId` of its own, so this nested clause is the entire
    // tenant boundary for the exported scores.
    expect(cellFindManyArgs).toHaveLength(1);
    expect(cellFindManyArgs[0].where).toEqual({
      schoolYearId: SCHOOL_YEAR_ID,
      term: OPEN_TERM,
      learner: learnerFindManyArgs[0].where,
    });
  });

  it("excludes archived and soft-deleted learners, and their cells", async () => {
    learners.push(
      learner({
        id: "learner-archived",
        fullName: "Bautista, Bert",
        archivedAt: new Date(2026, 9, 1),
      }),
      learner({
        id: "learner-deleted",
        fullName: "Castro, Cita",
        deletedAt: new Date(2026, 9, 1),
      })
    );
    cells.push(
      cell({ learnerId: "learner-archived", subject: "SCIENCE", score: 71 }),
      cell({ learnerId: "learner-deleted", subject: "SCIENCE", score: 72 })
    );

    const file = fileOf(await post());
    const { rows } = await readExport(file.base64);

    expect(rows.map((r) => r[1])).toEqual([
      "Complete Name",
      "Abad, Ana",
      "Zabala, Zeny",
    ]);
    // Their cells are gone too — the counts come from the same clause.
    expect(writeAudit.mock.calls[0][0].metadata).toMatchObject({
      learnerCount: 2,
      cellCount: 3,
    });
  });

  it("still produces a valid workbook for an empty advisory section", async () => {
    learners = [];
    cells = [];

    const file = fileOf(await post());
    const { rows, info } = await readExport(file.base64);

    // Headers only. An empty roster is a real state (a section with no learners
    // yet), and it must download rather than error.
    expect(rows).toEqual([HEADER_ROW]);
    expect(info[3]).toEqual(["Learner count", 0]);
    expect(writeAudit.mock.calls[0][0].metadata).toMatchObject({
      learnerCount: 0,
      cellCount: 0,
    });
  });
});

describe("exportTermGrades — the teacher branch is pinned to the advisory section", () => {
  /** A live second section of the SAME grade, in the same school. */
  function addSiblingSection() {
    sections.push({
      id: OTHER_SECTION_ID,
      name: "Rosal",
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      gradeType: "G7",
      deletedAt: null,
    });
    learners.push(
      learner({
        id: "learner-bea",
        fullName: "Bonifacio, Bea",
        sectionId: OTHER_SECTION_ID,
      })
    );
    cells.push(cell({ learnerId: "learner-bea", subject: "ENGLISH", score: 78 }));
  }

  it("ignores a posted ?section= naming another section of its own grade", async () => {
    // The one behaviour where the export payload and the sheet's own filtering
    // deliberately disagree: `section` exists for the Super Admin branch, and a
    // teacher's roster IS their advisory section. A stale tab, or a hand-made
    // payload, must not widen or redirect the export.
    addSiblingSection();

    const file = fileOf(await post({ section: OTHER_SECTION_ID }));

    // Asserted against what Prisma was handed, not against mere success — success
    // alone would also be the outcome if the posted section were honoured.
    expect(learnerFindManyArgs[0].where).toEqual({
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      sectionId: SECTION_ID,
      deletedAt: null,
      archivedAt: null,
    });

    const { rows } = await readExport(file.base64);
    expect(rows.map((r) => r[1])).toEqual([
      "Complete Name",
      "Abad, Ana",
      "Zabala, Zeny",
    ]);
    // And the other section's score is nowhere in the bytes.
    expect(JSON.stringify(rows)).not.toContain("78");
    expect(writeAudit.mock.calls[0][0].metadata).toMatchObject({
      sectionId: SECTION_ID,
      learnerCount: 2,
      cellCount: 3,
    });
  });

  it("ignores ?section=all, which would otherwise export the whole grade", async () => {
    addSiblingSection();

    await post({ section: "all" });

    expect(learnerFindManyArgs[0].where).toMatchObject({ sectionId: SECTION_ID });
  });

  it("ignores ?section=none, which would otherwise export the unassigned learners", async () => {
    // The nastiest of the three: `sectionIdWhere("none")` is `sectionId: null`, so
    // a teacher branch that consulted it would swap its own roster for the school's
    // floating learners rather than merely widening.
    learners.push(
      learner({ id: "learner-floating", fullName: "Cruz, Carla", sectionId: null })
    );

    const file = fileOf(await post({ section: "none" }));

    expect(learnerFindManyArgs[0].where).toMatchObject({ sectionId: SECTION_ID });
    const { rows } = await readExport(file.base64);
    expect(rows.map((r) => r[1])).not.toContain("Cruz, Carla");
  });

  it("does narrow by ?q=, case-insensitively, inside the advisory section", async () => {
    // `q` is honoured — the workbook should match the rows the teacher was looking
    // at. Lowercase against a capitalised name, so a dropped `mode` fails here.
    const file = fileOf(await post({ q: "zab" }));

    expect(learnerFindManyArgs[0].where).toEqual({
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      sectionId: SECTION_ID,
      deletedAt: null,
      archivedAt: null,
      fullName: { contains: "zab", mode: "insensitive" },
    });
    const { rows } = await readExport(file.base64);
    expect(rows.map((r) => r[1])).toEqual(["Complete Name", "Zabala, Zeny"]);
  });
});

describe("exportTermGrades — cross-tenant refusal", () => {
  it("refuses another school's grade, and answers exactly as it does for a grade that does not exist", async () => {
    // The grade is REAL and lives in another tenant. The refusal must be
    // indistinguishable from "no such grade" and from "a grade in your own school
    // that you do not advise", or the error itself becomes an existence oracle.
    grades.push({ id: FOREIGN_GRADE_ID, schoolId: OTHER_SCHOOL_ID, deletedAt: null });
    grades.push({ id: OTHER_GRADE_ID, schoolId: SCHOOL_ID, deletedAt: null });

    const crossTenant = await post({ gradeLevelId: FOREIGN_GRADE_ID });
    expect(errorOf(crossTenant)).toBe("You are not assigned to this grade level");
    expectRefusedBeforeReading();
    // The teacher branch must never resolve a grade globally — that lookup is the
    // Super Admin's, and reaching for it here is how a leak would be introduced.
    expect(gradeLevelFindFirst).not.toHaveBeenCalled();

    vi.clearAllMocks();
    const sameSchoolOtherGrade = await post({ gradeLevelId: OTHER_GRADE_ID });
    vi.clearAllMocks();
    const nonexistent = await post({ gradeLevelId: "grade-does-not-exist" });

    expect(crossTenant).toEqual(sameSchoolOtherGrade);
    expect(crossTenant).toEqual(nonexistent);
    // And the response names nothing: no school, no grade id.
    const serialized = JSON.stringify(crossTenant);
    for (const secret of [OTHER_SCHOOL_ID, FOREIGN_GRADE_ID, OTHER_GRADE_ID]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("refuses a teacher whose advisory section turns out to be in another school", async () => {
    // Same section id, same grade id, different school — so `schoolId` is the ONLY
    // clause in the placement lookup that can exclude it. Delete that clause and
    // this export succeeds against a foreign section, which is what must fail.
    sections = sections.map((s) => ({ ...s, schoolId: OTHER_SCHOOL_ID }));

    const res = await post();

    expect(errorOf(res)).toBe(
      "You have no advisory section yet. Ask your School Head to assign you one before adding learners."
    );
    expectRefusedBeforeReading();
  });

  it("excludes another school's learner that shares the grade AND section ids", async () => {
    // The sharpest tenancy case in this file. The foreign learner is identical to a
    // legitimate one in every clause except `schoolId`, and sorts between the two
    // real rows, so a roster `where` that lost its tenant filter would show up as
    // an extra row here AND as a wrong `cellCount` in the audit.
    learners.push(
      learner({
        id: "learner-other-school",
        fullName: "Abad, Anabelle",
        schoolId: OTHER_SCHOOL_ID,
        gradeLevelId: GRADE_ID,
        sectionId: SECTION_ID,
      })
    );
    cells.push(
      cell({ learnerId: "learner-other-school", subject: "ENGLISH", score: 78 })
    );

    const file = fileOf(await post());
    const { rows } = await readExport(file.base64);

    expect(rows.map((r) => r[1])).toEqual([
      "Complete Name",
      "Abad, Ana",
      "Zabala, Zeny",
    ]);
    const bytes = JSON.stringify(rows);
    expect(bytes).not.toContain("Anabelle");
    expect(bytes).not.toContain("78");
    expect(writeAudit.mock.calls[0][0].metadata).toMatchObject({
      learnerCount: 2,
      cellCount: 3,
    });
  });
});

describe("exportTermGrades — refusal: no advisory placement", () => {
  it("refuses a teacher with no advisory section", async () => {
    session.advisorySectionId = null;

    const res = await post();

    expect(errorOf(res)).toBe(
      "You have no advisory section yet. Ask your School Head to assign you one before adding learners."
    );
    expectRefusedBeforeReading();
  });

  it("refuses a teacher whose advisory section was soft-deleted", async () => {
    // The session pointer is not enough: a School Head can delete the section
    // afterwards, and exporting it would produce a sheet no roster page lists.
    sections = sections.map((s) => ({ ...s, deletedAt: new Date(2026, 10, 1) }));

    const res = await post();

    expect(errorOf(res)).toContain("no advisory section");
    expectRefusedBeforeReading();
  });

  it("refuses a Non-DepEd ARAL volunteer before the placement is even looked up", async () => {
    designation = ARAL_VOLUNTEER_DESIGNATION;
    session.advisorySectionId = SECTION_ID;

    const res = await post();

    expect(errorOf(res)).toBe(
      "End of Terms Reports is for DepEd teachers who advise a section."
    );
    // The designation gate runs first, so data drift (a volunteer holding a section
    // by mistake) cannot route around it.
    expect(sectionFindFirst).not.toHaveBeenCalled();
    expectRefusedBeforeReading();
  });

  it("refuses a non-admin account that carries no school at all", async () => {
    // A legacy teacher row with a null `schoolId` reaches this action, because
    // `requireUser` — unlike `requireSchoolUser` — does not guarantee one.
    session.schoolId = null;

    const res = await post();

    expect(errorOf(res)).toBe("Not found");
    expect(teacherProfileFindFirst).not.toHaveBeenCalled();
    expectRefusedBeforeReading();
  });

  it("refuses when the school has no active school year", async () => {
    schoolYears = [];

    const res = await post();

    expect(errorOf(res)).toContain("No school year is active");
    expectRefusedBeforeReading();
  });

  it("does not borrow another school's active year", async () => {
    schoolYears = [
      {
        id: "sy-other-school",
        label: "2026-2027",
        schoolId: OTHER_SCHOOL_ID,
        isActive: true,
        startDate: SCHOOL_YEAR_START,
      },
    ];

    const res = await post();

    expect(errorOf(res)).toContain("No school year is active");
    expect(JSON.stringify(res)).not.toContain("sy-other-school");
    expectRefusedBeforeReading();
  });
});

describe("exportTermGrades — the Super Admin branch", () => {
  it("derives the school from the grade, not from the session", async () => {
    // The session's `schoolId` is deliberately WRONG here — a different tenant
    // entirely. Everything downstream must key off the grade lookup, so a branch
    // that fell back to the session would resolve the wrong school year and the
    // wrong roster instead of quietly working by coincidence.
    asSuperAdmin(OTHER_SCHOOL_ID);
    sections.push({
      id: OTHER_SECTION_ID,
      name: "Rosal",
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      gradeType: "G7",
      deletedAt: null,
    });
    learners.push(
      learner({
        id: "learner-bea",
        fullName: "Bonifacio, Bea",
        sectionId: OTHER_SECTION_ID,
      })
    );

    const file = fileOf(await post());

    expect(gradeLevelFindFirst.mock.calls[0][0].where).toEqual({
      id: GRADE_ID,
      deletedAt: null,
    });
    // Derived, not from the session.
    expect(schoolYearFindFirst.mock.calls[0][0].where).toEqual({
      schoolId: SCHOOL_ID,
      isActive: true,
    });
    // No `sectionId` key at all: an admin reads the whole grade across sections.
    expect(learnerFindManyArgs[0].where).toEqual({
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      deletedAt: null,
      archivedAt: null,
    });

    const { rows } = await readExport(file.base64);
    expect(rows.map((r) => r[1])).toEqual([
      "Complete Name",
      "Abad, Ana",
      "Bonifacio, Bea",
      "Zabala, Zeny",
    ]);

    // The advisory gate is skipped entirely — an admin holds no TeacherProfile and
    // advises nothing, so running it would refuse a viewer who is entitled.
    expect(teacherProfileFindFirst).not.toHaveBeenCalled();
    expect(sectionFindFirst).not.toHaveBeenCalled();

    const audit = writeAudit.mock.calls[0][0];
    expect(audit.userId).toBe(ADMIN_ID);
    expect(audit.schoolId).toBe(SCHOOL_ID);
    expect(audit.metadata).toMatchObject({
      schoolId: SCHOOL_ID,
      sectionId: null,
      role: "SUPER_ADMIN",
    });
  });

  it("works for an admin holding no schoolId at all", async () => {
    // The reason the action uses `requireUser` and not `requireSchoolUser`.
    asSuperAdmin(null);

    const file = fileOf(await post());

    expect(schoolYearFindFirst.mock.calls[0][0].where).toEqual({
      schoolId: SCHOOL_ID,
      isActive: true,
    });
    expect(learnerFindManyArgs[0].where).toMatchObject({ schoolId: SCHOOL_ID });
    expect(file.filename).toBe(`litrack-term-grades-second-${TODAY_KEY}.xlsx`);
  });

  it("refuses a soft-deleted grade, identically to one that never existed", async () => {
    asSuperAdmin(null);
    grades = [{ id: GRADE_ID, schoolId: SCHOOL_ID, deletedAt: new Date(2026, 5, 1) }];

    const softDeleted = await post();
    expect(errorOf(softDeleted)).toBe("Not found");
    expectRefusedBeforeReading();

    vi.clearAllMocks();
    grades = [];
    const missing = await post();

    // Same generic answer, so a deleted school's grade ids cannot be enumerated.
    expect(softDeleted).toEqual(missing);
    expectRefusedBeforeReading();
  });

  it("honours ?section= — the branch where the filter is real", async () => {
    // The counterpart to the teacher pinning tests: proving the admin filter works
    // is what makes "the teacher branch ignores it" a deliberate asymmetry rather
    // than a filter that is simply broken everywhere.
    asSuperAdmin(null);
    learners.push(
      learner({
        id: "learner-bea",
        fullName: "Bonifacio, Bea",
        sectionId: OTHER_SECTION_ID,
      })
    );

    const file = fileOf(await post({ section: OTHER_SECTION_ID }));

    expect(learnerFindManyArgs[0].where).toEqual({
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      sectionId: OTHER_SECTION_ID,
      deletedAt: null,
      archivedAt: null,
    });
    const { rows } = await readExport(file.base64);
    expect(rows.map((r) => r[1])).toEqual(["Complete Name", "Bonifacio, Bea"]);
    expect(writeAudit.mock.calls[0][0].metadata).toMatchObject({
      sectionId: OTHER_SECTION_ID,
    });
  });

  it("queries sectionId: null for ?section=none but logs 'none' verbatim", async () => {
    // Deliberate, and documented in the action: the audit row has to distinguish
    // "the whole grade" (null) from "the learners with no section" ("none").
    asSuperAdmin(null);
    learners.push(
      learner({ id: "learner-floating", fullName: "Cruz, Carla", sectionId: null })
    );

    const file = fileOf(await post({ section: "none" }));

    expect(learnerFindManyArgs[0].where).toMatchObject({ sectionId: null });
    const { rows } = await readExport(file.base64);
    expect(rows.map((r) => r[1])).toEqual(["Complete Name", "Cruz, Carla"]);
    expect(writeAudit.mock.calls[0][0].metadata).toMatchObject({ sectionId: "none" });
  });

  it("refuses when the derived school has no active year", async () => {
    asSuperAdmin(null);
    schoolYears = [];

    const res = await post();

    expect(errorOf(res)).toContain("No school year is active");
    expectRefusedBeforeReading();
  });
});

describe("exportTermGrades — a locked term still exports", () => {
  it("exports First Term after its months have passed", async () => {
    // The deliberate asymmetry with `saveTermGrades`, which refuses this exact
    // payload. Viewing and exporting survive the lock; only encoding stops. Nothing
    // else asserts this, so a regression that copied the save action's lock check
    // into export would be invisible.
    const [first] = getTermWindows(SCHOOL_YEAR_START);
    expect(isTermLocked(first, TODAY_KEY)).toBe(true);

    cells = [
      cell({ learnerId: "learner-ana", subject: "ENGLISH", score: 87, term: "FIRST" }),
      // A Second Term cell that must NOT appear on a First Term sheet.
      cell({ learnerId: "learner-ana", subject: "SCIENCE", score: 93 }),
    ];

    const file = fileOf(await post({ term: LOCKED_TERM }));

    expect(file.filename).toBe(`litrack-term-grades-first-${TODAY_KEY}.xlsx`);
    const { sheetNames, rows, info } = await readExport(file.base64);
    expect(sheetNames).toEqual(["First Term", "Export info"]);
    expect(rows).toEqual([
      HEADER_ROW,
      // English 87 from First Term; the Second Term Science 93 is filtered out.
      expectedRow(1, "Abad, Ana", { ENGLISH: 87 }, 87),
      expectedRow(2, "Zabala, Zeny", {}, null),
    ]);
    expect(info[1]).toEqual(["Term", "First Term"]);
    expect(info[2]).toEqual(["Months", "August - October"]);
    expect(cellFindManyArgs[0].where).toMatchObject({ term: "FIRST" });
    expectReadOnly();
  });

  it("exports a term that has not started yet", async () => {
    // Third Term is Feb-Apr 2027 — in the future on the fixture clock. An empty
    // sheet is the right answer, not a refusal.
    const file = fileOf(await post({ term: "THIRD" }));

    expect(file.filename).toBe(`litrack-term-grades-third-${TODAY_KEY}.xlsx`);
    const { rows, info } = await readExport(file.base64);
    expect(rows).toEqual([
      HEADER_ROW,
      expectedRow(1, "Abad, Ana", {}, null),
      expectedRow(2, "Zabala, Zeny", {}, null),
    ]);
    expect(info[1]).toEqual(["Term", "Third Term"]);
  });
});

describe("exportTermGrades — the audit row", () => {
  it("logs ids and counts, and NO score value anywhere in the metadata", async () => {
    await post();

    expect(writeAudit).toHaveBeenCalledTimes(1);
    const audit = writeAudit.mock.calls[0][0];
    expect(audit.userId).toBe(TEACHER_ID);
    expect(audit.schoolId).toBe(SCHOOL_ID);
    expect(audit.action).toBe("TERM_GRADES_EXPORT");
    expect(audit.resource).toBe("TermGrade");
    expect(audit.resourceId).toBe(GRADE_ID);
    // EXACT, because that is the only assertion a newly added `scores` key cannot
    // slip past.
    expect(audit.metadata).toEqual({
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      sectionId: SECTION_ID,
      term: OPEN_TERM,
      schoolYearId: SCHOOL_YEAR_ID,
      learnerCount: 2,
      cellCount: 3,
      role: "TEACHER",
    });

    // The PII rule, asserted over the whole serialization rather than spot-checked
    // on one key, and derived from the fixture so it cannot fall behind it. Term
    // grades are learner PII (`docs/privacy.md`); `AuditLog` gets counts only.
    const serialized = JSON.stringify(audit.metadata);
    const fixtureScores = [...new Set(cells.map((c) => String(c.score)))];
    expect(fixtureScores.length).toBeGreaterThan(0);
    // Two layers: substring catches a score embedded in a string
    // ("87,93,64"), token catches one stored as a number that happens not to be a
    // substring of anything.
    const numberTokens = new Set(serialized.match(/\d+/g) ?? []);
    for (const score of fixtureScores) {
      expect(serialized, `metadata must not contain the score ${score}`).not.toContain(
        score
      );
      expect(numberTokens.has(score), `metadata must not carry ${score} as a number`).toBe(
        false
      );
    }

    // Non-vacuity: those same scores DO exist and DID reach the workbook, so their
    // absence above is a real exclusion and not an empty fixture.
    const { rows } = await readExport(fileOf(await post()).base64);
    const exported = JSON.stringify(rows);
    for (const score of fixtureScores) {
      expect(exported).toContain(score);
    }
  });

  it("logs nothing when the export is refused", async () => {
    session.advisorySectionId = null;

    await post();

    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("exportTermGrades — the filename", () => {
  it("names the file for the term and the school's local day", async () => {
    for (const [term, slug] of [
      ["FIRST", "first"],
      ["SECOND", "second"],
      ["THIRD", "third"],
    ]) {
      vi.clearAllMocks();
      learnerFindManyArgs = [];
      cellFindManyArgs = [];
      const file = fileOf(await post({ term }));
      expect(file.filename).toBe(`litrack-term-grades-${slug}-${TODAY_KEY}.xlsx`);
    }
  });

  it("uses the Manila civil day, not the UTC one, when the two disagree", async () => {
    // The ONE place in this file a UTC instant is the correct fixture: the whole
    // point is an instant where the server's calendar and the school's disagree.
    // 20:00Z on Dec 15 is already 04:00 on Dec 16 in Manila, which is exactly the
    // window where `toISOString().slice(0, 10)` names the file for yesterday.
    //
    // TZ-independent: both `schoolToday()` and `toISOString()` read the absolute
    // instant, so this holds under `Asia/Singapore` and under `TZ=UTC`.
    vi.setSystemTime(new Date(Date.UTC(2026, 11, 15, 20, 0, 0)));

    const file = fileOf(await post());

    expect(file.filename).toBe("litrack-term-grades-second-2026-12-16.xlsx");
    // The bug this guards against, stated so the test explains itself.
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-12-15");
    expect(file.filename).not.toContain("2026-12-15");
  });
});

describe("exportTermGrades — Zod refusals", () => {
  it("refuses malformed payloads without reading or logging anything", async () => {
    const malformed: unknown[] = [
      // Missing / blank ids.
      { term: OPEN_TERM },
      { gradeLevelId: "", term: OPEN_TERM },
      // Terms that name no window. `resolveTermWindow` must never see these, or an
      // unrecognised term would be treated as unlocked and exported as a blank
      // sheet of the wrong name.
      { gradeLevelId: GRADE_ID, term: "FOURTH" },
      { gradeLevelId: GRADE_ID, term: "second" },
      { gradeLevelId: GRADE_ID },
      // Wrong types on the optional filters.
      { gradeLevelId: GRADE_ID, term: OPEN_TERM, section: 7 },
      { gradeLevelId: GRADE_ID, term: OPEN_TERM, q: ["santos"] },
      // Not an object at all.
      null,
      undefined,
      GRADE_ID,
      [],
    ];

    for (const input of malformed) {
      vi.clearAllMocks();
      learnerFindManyArgs = [];
      cellFindManyArgs = [];
      const res = await exportTermGrades(input);

      expect(res.ok, `${JSON.stringify(input)} should be refused`).toBe(false);
      expectRefusedBeforeReading();
      // Validation happens after the auth guard, per the house pattern, and before
      // any placement lookup.
      expect(requireUser).toHaveBeenCalledWith("TEACHER");
      expect(sectionFindFirst).not.toHaveBeenCalled();
      expect(gradeLevelFindFirst).not.toHaveBeenCalled();
    }
  });

  it("refuses a malformed payload from a Super Admin too", async () => {
    // The Zod gate sits above the role branch, so it cannot be skipped by the
    // caller who is allowed to cross tenants.
    asSuperAdmin(null);

    const res = await exportTermGrades({ gradeLevelId: GRADE_ID, term: "FOURTH" });

    expect(res.ok).toBe(false);
    expect(gradeLevelFindFirst).not.toHaveBeenCalled();
    expectRefusedBeforeReading();
  });
});
