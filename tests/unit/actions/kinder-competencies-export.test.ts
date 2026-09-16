import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Action-level coverage for `exportKinderChecklist` — specifically the
 * SCHOOL_HEAD authorization branch added alongside the existing TEACHER
 * (advisory-scoped) and SUPER_ADMIN (learner-derived) branches.
 *
 * Same shape as `tests/unit/actions/term-grades-export.test.ts`: only leaf
 * Prisma calls, the session guard, audit and cache are mocked. The real Zod
 * schema, the real `getAdvisoryPlacements`/`resolveAdvisoryTarget`/
 * `splitByKinderGradeType`, and the real `exceljs` all run.
 *
 * This module uses the `action()` wrapper (throw `AppError`, never hand-roll
 * `{ ok: false, error }`), so failures are read off the wrapper's own
 * `ActionFailure` shape (`{ ok: false, code, error }`) rather than the legacy
 * `{ ok: false, error }` shape `term-grades.ts` still uses. `action()` itself,
 * `classifyError` and `resourceNotFound` are all real — a `NOT_FOUND` is
 * "user" severity, so it never reaches `reportError`/`ErrorEvent`, which is
 * why those are left unmocked here.
 */

const SCHOOL_ID = "school-malandag";
const OTHER_SCHOOL_ID = "school-kiblawan";
const KINDER_GRADE_ID = "grade-kinder";
const KINDER_SECTION_ID = "section-mabini";
const OTHER_KINDER_SECTION_ID = "section-luna";
const NON_KINDER_GRADE_ID = "grade-g1";
const TEACHER_ID = "teacher-marivic";
const SCHOOL_HEAD_ID = "head-lourdes";
const SCHOOL_YEAR_ID = "sy-2026-2027";
const SCHOOL_YEAR_LABEL = "2026-2027";

type LearnerRow = {
  id: string;
  fullName: string;
  schoolId: string;
  gradeLevelId: string;
  sectionId: string | null;
  gradeType: string;
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
  adviserId: string | null;
};

let learners: LearnerRow[];
let sections: SectionRow[];
let schoolYearActive: boolean;

/** What `requireUser` resolves for this call. */
let session: {
  id: string;
  schoolId: string | null;
  role: "TEACHER" | "SCHOOL_HEAD" | "SUPER_ADMIN";
};

function learner(overrides: Partial<LearnerRow> & { id: string; fullName: string }): LearnerRow {
  return {
    schoolId: SCHOOL_ID,
    gradeLevelId: KINDER_GRADE_ID,
    sectionId: KINDER_SECTION_ID,
    gradeType: "KINDER",
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

/** Backs both `learner.findFirst` shapes the action uses — the role-derivation
 * read (selects `gradeLevel`) and the final tenant-scoped read (selects
 * `fullName`). Distinguished by which `select` the action asked for, exactly
 * like the real Prisma client would answer either query. */
const learnerFindFirst = vi.fn(
  async (args: {
    where: Record<string, unknown>;
    select: Record<string, unknown>;
  }) => {
    const found = learners.find((l) => matchesWhere(l, args.where));
    if (!found) return null;
    if (args.select.gradeLevel) {
      return {
        schoolId: found.schoolId,
        gradeLevelId: found.gradeLevelId,
        sectionId: found.sectionId,
        gradeLevel: { type: found.gradeType },
      };
    }
    return { id: found.id, fullName: found.fullName };
  }
);

/** Backs `getAdvisoryPlacements` — the teacher branch's only source of scope. */
const sectionFindMany = vi.fn(
  async (args: { where: { adviserId: string; schoolId: string; deletedAt: null } }) =>
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

const schoolYearFindFirst = vi.fn(
  async (args: { where: { schoolId: string; isActive: boolean } }) => {
    if (!schoolYearActive) return null;
    return { id: SCHOOL_YEAR_ID, label: SCHOOL_YEAR_LABEL };
  }
);

const kinderCompetencyRecordFindMany = vi.fn(async (_args?: unknown) => []);

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      findFirst: (...args: unknown[]) => learnerFindFirst(...(args as [never])),
    },
    section: {
      findMany: (...args: unknown[]) => sectionFindMany(...(args as [never])),
    },
    schoolYear: {
      findFirst: (...args: unknown[]) => schoolYearFindFirst(...(args as [never])),
    },
    kinderCompetencyRecord: {
      findMany: (...args: unknown[]) => kinderCompetencyRecordFindMany(...(args as [never])),
    },
  },
}));

const requireUser = vi.fn(async () => session);
const requireSchoolUser = vi.fn(async () => session);
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...(args as [])),
  requireSchoolUser: (...args: unknown[]) => requireSchoolUser(...(args as [])),
}));

const writeAudit = vi.fn(async (_entry?: unknown) => {});
vi.mock("@/lib/audit", () => ({
  writeAudit: (...args: unknown[]) => writeAudit(...(args as [never])),
  AUDIT_ACTIONS: { KINDER_COMPETENCY_BULK_SAVE: "KINDER_COMPETENCY_BULK_SAVE" },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePath(...(args as [])),
}));

// Imported after the mock factories above are registered.
const { exportKinderChecklist } = await import("@/lib/actions/kinder-competencies");

type ExportResult = Awaited<ReturnType<typeof exportKinderChecklist>>;

function post(overrides: { learnerId?: string; advisorySectionId?: string } = {}) {
  return exportKinderChecklist({
    learnerId: "learner-nico",
    ...overrides,
  });
}

function fileOf(res: ExportResult): { filename: string; base64: string } {
  if (!res.ok) throw new Error(`expected a workbook, got refusal: ${res.error}`);
  return res.data;
}

function errorOf(res: ExportResult): string {
  if (res.ok) throw new Error("expected a refusal, got a workbook");
  return res.error;
}

beforeEach(() => {
  vi.clearAllMocks();

  learners = [learner({ id: "learner-nico", fullName: "Reyes, Nico" })];
  sections = [
    {
      id: KINDER_SECTION_ID,
      name: "Mabini",
      schoolId: SCHOOL_ID,
      gradeLevelId: KINDER_GRADE_ID,
      gradeType: "KINDER",
      deletedAt: null,
      adviserId: TEACHER_ID,
    },
  ];
  schoolYearActive = true;

  session = { id: TEACHER_ID, schoolId: SCHOOL_ID, role: "TEACHER" };
});

describe("exportKinderChecklist — teacher branch (unchanged)", () => {
  it("exports a learner in the caller's own advisory section", async () => {
    const file = fileOf(await post());

    expect(requireUser).toHaveBeenCalledWith(["TEACHER", "SCHOOL_HEAD"]);
    expect(file.filename).toMatch(/^litrack-kinder-checklist-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it("still refuses a learner outside the advisory section", async () => {
    learners.push(
      learner({
        id: "learner-outside",
        fullName: "Cruz, Ana",
        sectionId: OTHER_KINDER_SECTION_ID,
      })
    );

    const res = await post({ learnerId: "learner-outside" });

    expect(res.ok).toBe(false);
  });
});

describe("exportKinderChecklist — School Head branch (new)", () => {
  beforeEach(() => {
    session = { id: SCHOOL_HEAD_ID, schoolId: SCHOOL_ID, role: "SCHOOL_HEAD" };
  });

  it("exports any Kindergarten learner in the School Head's own school", async () => {
    // Not this section's adviser, and not in `sections` at all — the School
    // Head path must not go through advisory placements.
    const file = fileOf(await post());

    expect(file.filename).toMatch(/^litrack-kinder-checklist-\d{4}-\d{2}-\d{2}\.xlsx$/);
    // The tenant filter rode on `user.schoolId` from the session, never a
    // client-supplied value — the fixture's only school id.
    expect(
      learnerFindFirst.mock.calls.some(
        (call) => (call[0] as { where: Record<string, unknown> }).where.schoolId === SCHOOL_ID
      )
    ).toBe(true);
  });

  it("refuses a learner in another school as a generic not-found", async () => {
    learners = [
      learner({
        id: "learner-nico",
        fullName: "Reyes, Nico",
        schoolId: OTHER_SCHOOL_ID,
      }),
    ];

    const res = await post();

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe("Learner not found. It may have been deleted or moved.");
      expect(res.code).toBe("NOT_FOUND");
    }
    // The response names nothing about the other school.
    expect(JSON.stringify(res)).not.toContain(OTHER_SCHOOL_ID);
  });

  it("refuses a non-Kindergarten learner", async () => {
    learners = [
      learner({
        id: "learner-nico",
        fullName: "Reyes, Nico",
        gradeLevelId: NON_KINDER_GRADE_ID,
        gradeType: "G1",
      }),
    ];

    const res = await post();

    expect(errorOf(res)).toBe("Learner not found. It may have been deleted or moved.");
  });
});
