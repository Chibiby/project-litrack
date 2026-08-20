import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatLocalDateKey } from "@/lib/date-keys";

/**
 * Tenant-isolation coverage for the read action behind the roster's Student
 * Profile dialog: `getLearnerProfile`, which feeds both the read-only tabs and
 * the in-place edit form.
 *
 * It used to have a sibling, `getLearnerEditContext`, fetched on the first Edit
 * press to fill the form's grade and section selects. Those selects are gone —
 * a learner joins their teacher's advisory section and moves only by transfer —
 * so this one read is now the whole surface.
 *
 * The dialog is reachable from any row a teacher can see, so this action is the
 * only thing standing between a guessed learner id and another school's child.
 * Only Prisma and the session are mocked — the real `teacherLearnerScope` and
 * the real date serialisation run, and the fake `findFirst` evaluates the
 * `where` the action actually builds rather than trusting it.
 */

const TEACHER_ID = "teacher-1";
const OTHER_TEACHER_ID = "teacher-2";
const SCHOOL_ID = "school-1";
const OTHER_SCHOOL_ID = "school-2";

type Row = {
  id: string;
  schoolId: string;
  teacherId: string | null;
  aralTeacherId: string | null;
  deletedAt: Date | null;
  [key: string]: unknown;
};

const CREATED_AT = new Date(2026, 0, 5, 7, 30);
const ARAL_ENROLLED_AT = new Date(2026, 1, 17, 23, 45);

function makeRow(overrides: Partial<Row> & { id: string }): Row {
  return {
    schoolId: SCHOOL_ID,
    teacherId: TEACHER_ID,
    aralTeacherId: null,
    deletedAt: null,
    fullName: "Ana Santos",
    firstName: "Ana",
    middleName: "R",
    lastName: "Santos",
    age: 10,
    gender: "FEMALE",
    ethnicity: null,
    ethnicityOther: null,
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    englishFrustrationSubtypes: [],
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
    filipinoFrustrationSubtypes: [],
    governmentBenefits: [],
    parentEducation: "COLLEGE_GRADUATE",
    modeOfTransportation: null,
    distanceHomeToSchool: null,
    previousTransfers: null,
    transferDetails: null,
    gradeLevelId: "grade-g3",
    isAralLearner: false,
    aralEnrolledAt: null,
    archivedAt: null,
    createdAt: CREATED_AT,
    gradeLevel: { id: "grade-g3", type: "G3" },
    section: { name: "Sampaguita" },
    teacher: { fullName: "Teacher One" },
    aralTeacher: null,
    enrollments: [],
    attendances: [],
    readingLevels: [],
    aralProfile: null,
    ...overrides,
  };
}

let rows: Row[];
const findFirst = vi.fn();

/** Evaluates the subset of Prisma `where` syntax the action builds. */
function matches(row: Row, where: Record<string, unknown>): boolean {
  if (where.id !== row.id) return false;
  if (where.deletedAt === null && row.deletedAt !== null) return false;
  if ("schoolId" in where && where.schoolId !== row.schoolId) return false;
  const or = where.OR as { teacherId?: string; aralTeacherId?: string }[] | undefined;
  if (or) {
    const scoped = or.some(
      (clause) =>
        (clause.teacherId !== undefined && clause.teacherId === row.teacherId) ||
        (clause.aralTeacherId !== undefined &&
          clause.aralTeacherId === row.aralTeacherId)
    );
    if (!scoped) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    learner: {
      findFirst: (...args: unknown[]) => findFirst(...(args as [])),
    },
  },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...args: unknown[]) => requireUser(...(args as [])),
}));

// Imported after the mock factories above are registered.
const { getLearnerProfile } = await import("@/lib/actions/learner-profile");

beforeEach(() => {
  vi.clearAllMocks();
  rows = [
    makeRow({ id: "own-advisory" }),
    makeRow({
      id: "own-aral",
      teacherId: OTHER_TEACHER_ID,
      aralTeacherId: TEACHER_ID,
      isAralLearner: true,
      aralEnrolledAt: ARAL_ENROLLED_AT,
      aralTeacher: { fullName: "Teacher One" },
    }),
    makeRow({ id: "other-advisory", teacherId: OTHER_TEACHER_ID }),
    makeRow({
      id: "other-school",
      schoolId: OTHER_SCHOOL_ID,
      teacherId: OTHER_TEACHER_ID,
    }),
    makeRow({ id: "soft-deleted", deletedAt: new Date(2026, 5, 1) }),
    makeRow({ id: "archived", archivedAt: new Date(2026, 6, 1) }),
  ];
  findFirst.mockImplementation(
    async (args: { where: Record<string, unknown> }) =>
      rows.find((r) => matches(r, args.where)) ?? null
  );
  requireUser.mockResolvedValue({
    id: TEACHER_ID,
    role: "TEACHER",
    schoolId: SCHOOL_ID,
  });
});

describe("getLearnerProfile — teacher scope", () => {
  it("returns a learner in the teacher's advisory", async () => {
    const res = await getLearnerProfile("own-advisory");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.id).toBe("own-advisory");
    expect(res.data.sectionName).toBe("Sampaguita");
    // The three placement facts the edit form shows read-only. They come from
    // this read alone now, which is what removed the round trip behind Edit.
    expect(res.data.gradeLevelId).toBe("grade-g3");
    expect(res.data.gradeType).toBe("G3");
    expect(res.data.adviserName).toBe("Teacher One");
  });

  it("returns an archived learner, which the dialog shows with its actions off", async () => {
    // No `archivedAt` filter here, unlike the writes: archived learners are
    // still readable, and the dialog needs the date to disable Edit and ARAL.
    const res = await getLearnerProfile("archived");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.archivedAt).toBe(formatLocalDateKey(new Date(2026, 6, 1)));
  });

  it("returns a learner the teacher only holds as ARAL tutor", async () => {
    const res = await getLearnerProfile("own-aral");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.isAralLearner).toBe(true);
    expect(res.data.aralTutorName).toBe("Teacher One");
  });

  it("hides a learner in the same school but another teacher's care", async () => {
    const res = await getLearnerProfile("other-advisory");
    expect(res).toEqual({ ok: false, error: "Not found" });
  });

  it("hides a learner in another school", async () => {
    const res = await getLearnerProfile("other-school");
    expect(res).toEqual({ ok: false, error: "Not found" });
  });

  it("hides a soft-deleted learner", async () => {
    const res = await getLearnerProfile("soft-deleted");
    expect(res).toEqual({ ok: false, error: "Not found" });
  });

  it("scopes the query by school and teacher rather than by id alone", async () => {
    await getLearnerProfile("own-advisory");
    const where = findFirst.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.schoolId).toBe(SCHOOL_ID);
    expect(where.deletedAt).toBeNull();
    expect(where.OR).toEqual([
      { teacherId: TEACHER_ID },
      { aralTeacherId: TEACHER_ID },
    ]);
  });

  it("rejects a blank id without querying", async () => {
    const res = await getLearnerProfile("   ");
    expect(res).toEqual({ ok: false, error: "Not found" });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("rejects a teacher with no school without querying", async () => {
    requireUser.mockResolvedValue({
      id: TEACHER_ID,
      role: "TEACHER",
      schoolId: null,
    });
    const res = await getLearnerProfile("own-advisory");
    expect(res).toEqual({ ok: false, error: "Not found" });
    expect(findFirst).not.toHaveBeenCalled();
  });
});

describe("getLearnerProfile — super admin", () => {
  beforeEach(() => {
    requireUser.mockResolvedValue({
      id: "admin-1",
      role: "SUPER_ADMIN",
      schoolId: null,
    });
  });

  it("reads across schools and drops the teacher scope", async () => {
    const res = await getLearnerProfile("other-school");
    expect(res.ok).toBe(true);
    const where = findFirst.mock.calls[0]?.[0]?.where as Record<string, unknown>;
    expect(where.OR).toBeUndefined();
    expect(where.schoolId).toBeUndefined();
    expect(where.deletedAt).toBeNull();
  });

  it("still hides soft-deleted learners", async () => {
    const res = await getLearnerProfile("soft-deleted");
    expect(res).toEqual({ ok: false, error: "Not found" });
  });
});

describe("getLearnerProfile — serialisation", () => {
  it("returns local date keys, never Date objects", async () => {
    rows[0].attendances = [
      {
        id: "att-1",
        date: new Date(2026, 2, 3, 7, 0),
        weekStart: new Date(2026, 2, 2, 7, 0),
        status: "PRESENT",
        notes: null,
      },
    ];
    rows[0].readingLevels = [
      {
        id: "rl-1",
        weekStart: new Date(2026, 2, 2, 7, 0),
        englishProfile: "INSTRUCTIONAL_DEVELOPING",
        filipinoProfile: "INSTRUCTIONAL_DEVELOPING",
        wordRecognitionLevel: null,
        readingComprehensionLevel: null,
        notes: null,
      },
    ];
    rows[0].enrollments = [
      {
        id: "enr-1",
        status: "ACTIVE",
        enrolledAt: new Date(2026, 5, 10, 7, 0),
        endedAt: null,
        schoolYear: { label: "2026-2027" },
        gradeLevel: { type: "G3" },
        section: { name: "Sampaguita" },
        teacher: { fullName: "Teacher One" },
      },
    ];

    const res = await getLearnerProfile("own-advisory");
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.createdAt).toBe(formatLocalDateKey(CREATED_AT));
    expect(res.data.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.data.attendances[0].date).toBe(
      formatLocalDateKey(new Date(2026, 2, 3, 7, 0))
    );
    expect(res.data.readingLevels[0].weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.data.enrollments[0].schoolYearLabel).toBe("2026-2027");
    expect(res.data.enrollments[0].endedAt).toBeNull();
    expect(JSON.parse(JSON.stringify(res.data))).toEqual(res.data);
  });

  it("keeps null relations null rather than inventing labels", async () => {
    rows[0].section = null;
    rows[0].teacher = null;
    rows[0].aralTeacher = null;
    const res = await getLearnerProfile("own-advisory");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.sectionName).toBeNull();
    expect(res.data.adviserName).toBeNull();
    expect(res.data.aralTutorName).toBeNull();
    expect(res.data.aralEnrolledAt).toBeNull();
  });
});
