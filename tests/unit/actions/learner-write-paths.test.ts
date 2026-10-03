import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFullName } from "@/lib/names";

/**
 * Success-path coverage for the learner write paths that mutate Enrollment
 * (audit B6): createLearner, updateLearner, archiveLearners, deleteLearners,
 * restoreLearner and setLearnerAralTeacher in src/lib/actions/learner.ts.
 *
 * The neighbouring suites only exercise the refusal paths, so deleting the
 * `enrollment.create` in createLearner, or the ARCHIVED status write on archive,
 * used to leave everything green. Each assertion below pins one write exactly.
 *
 * Style follows tests/unit/learner-bulk-tenancy.test.ts: the real `action()`
 * wrapper, real validators, real advisory / reactivate-enrollment / aral-tutor
 * logic, and a hand-built Prisma surface. `tx` and the global client are
 * deliberately different objects, so a write that escapes the transaction hits an
 * undefined method and fails the test instead of passing silently.
 */

const SCHOOL_ID = "school-1";
const OTHER_SCHOOL_ID = "school-2";
const TEACHER_ID = "teacher-1";
const HEAD_ID = "head-1";
const YEAR_ID = "sy-2026";
const GRADE_ID = "grade-g4";
const SECTION_ID = "11111111-1111-4111-8111-111111111111";
const LEARNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEARNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TUTOR_OK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TUTOR_OTHER_SCHOOL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TUTOR_INACTIVE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TUTOR_UNKNOWN = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const m = vi.hoisted(() => ({
  // global client
  learnerFindMany: vi.fn(),
  learnerFindFirst: vi.fn(),
  learnerUpdate: vi.fn(),
  sectionFindMany: vi.fn(),
  schoolYearFindFirst: vi.fn(),
  userFindFirst: vi.fn(),
  // transaction client
  txLearnerCreate: vi.fn(),
  txLearnerUpdate: vi.fn(),
  txLearnerUpdateMany: vi.fn(),
  txEnrollmentCreate: vi.fn(),
  txEnrollmentUpdate: vi.fn(),
  txEnrollmentUpdateMany: vi.fn(),
  txEnrollmentFindFirst: vi.fn(),
  txSchoolYearFindFirst: vi.fn(),
  txQueryRaw: vi.fn(),
  // collaborators
  writeAudit: vi.fn(),
  writeAuditMany: vi.fn(),
  notifyAralAssigned: vi.fn(),
  roleAsked: vi.fn(),
  currentUser: { current: null as unknown },
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    learner: {
      create: (a: unknown) => m.txLearnerCreate(a),
      update: (a: unknown) => m.txLearnerUpdate(a),
      updateMany: (a: unknown) => m.txLearnerUpdateMany(a),
    },
    enrollment: {
      create: (a: unknown) => m.txEnrollmentCreate(a),
      update: (a: unknown) => m.txEnrollmentUpdate(a),
      updateMany: (a: unknown) => m.txEnrollmentUpdateMany(a),
      findFirst: (a: unknown) => m.txEnrollmentFindFirst(a),
    },
    schoolYear: { findFirst: (a: unknown) => m.txSchoolYearFindFirst(a) },
    $queryRaw: (...a: unknown[]) => m.txQueryRaw(...a),
  };
  return {
    prisma: {
      learner: {
        findMany: (a: unknown) => m.learnerFindMany(a),
        findFirst: (a: unknown) => m.learnerFindFirst(a),
        update: (a: unknown) => m.learnerUpdate(a),
      },
      section: { findMany: (a: unknown) => m.sectionFindMany(a) },
      schoolYear: { findFirst: (a: unknown) => m.schoolYearFindFirst(a) },
      user: { findFirst: (a: unknown) => m.userFindFirst(a) },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock("@/lib/auth/session", () => ({
  requireSchoolUser: async (role?: string) => {
    m.roleAsked(role);
    return m.currentUser.current;
  },
}));
vi.mock("@/lib/audit", () => ({
  writeAudit: (a: unknown) => m.writeAudit(a),
  writeAuditMany: (a: unknown) => m.writeAuditMany(a),
  AUDIT_ACTIONS: {
    LEARNER_CREATE: "LEARNER_CREATE",
    LEARNER_UPDATE: "LEARNER_UPDATE",
    LEARNER_ARCHIVE: "LEARNER_ARCHIVE",
    LEARNER_RESTORE: "LEARNER_RESTORE",
    LEARNER_DELETE: "LEARNER_DELETE",
    LEARNER_TOGGLE_ARAL: "LEARNER_TOGGLE_ARAL",
    LEARNER_ENROLL_ARAL: "LEARNER_ENROLL_ARAL",
    LEARNER_SET_ARAL_TEACHER: "LEARNER_SET_ARAL_TEACHER",
  },
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TEST") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: vi.fn(),
  revalidateSchoolHeadTeachers: vi.fn(),
}));
vi.mock("@/lib/notifications", () => ({
  notifyAralAssigned: (a: unknown) => m.notifyAralAssigned(a),
}));

const {
  createLearner,
  updateLearner,
  archiveLearners,
  deleteLearners,
  restoreLearner,
  setLearnerAralTeacher,
} = await import("@/lib/actions/learner");

const teacher = {
  id: TEACHER_ID,
  schoolId: SCHOOL_ID,
  role: "TEACHER",
  profileCompleted: true,
};
const head = { id: HEAD_ID, schoolId: SCHOOL_ID, role: "SCHOOL_HEAD", profileCompleted: true };

const firstArg = (fn: { mock: { calls: unknown[][] } }, i = 0) =>
  fn.mock.calls[i][0] as Record<string, unknown>;

function form(entries: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
  }
  return fd;
}

const ids = (...list: string[]) => form({ learnerIds: list });

/** A valid Section A payload for a Grade 4 learner (English + Filipino both collected). */
const sectionA = {
  firstName: "Maria",
  lastName: "Santos",
  age: "9",
  gender: "FEMALE",
  nutritionalStatus: "NORMAL",
  englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
  filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
  parentEducation: "SECONDARY_GRADUATE",
};

/** Fake tables for setLearnerAralTeacher so tenancy / eligibility filters are real predicates. */
type Row = Record<string, unknown>;
let users: Row[];
let learners: Row[];
const matchesWhere = (row: Row, where: Row) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

beforeEach(() => {
  for (const fn of Object.values(m)) {
    if (typeof fn === "function" && "mockReset" in fn) (fn as { mockReset(): void }).mockReset();
  }
  m.currentUser.current = teacher;

  users = [
    { id: TUTOR_OK, schoolId: SCHOOL_ID, role: "TEACHER", deletedAt: null, isActive: true, approvalStatus: "APPROVED" },
    { id: TUTOR_OTHER_SCHOOL, schoolId: OTHER_SCHOOL_ID, role: "TEACHER", deletedAt: null, isActive: true, approvalStatus: "APPROVED" },
    { id: TUTOR_INACTIVE, schoolId: SCHOOL_ID, role: "TEACHER", deletedAt: null, isActive: false, approvalStatus: "APPROVED" },
  ];
  m.userFindFirst.mockImplementation(async (a: { where: Row }) => {
    const hit = users.find((u) => matchesWhere(u, a.where));
    return hit ? { id: hit.id } : null;
  });

  learners = [
    {
      id: LEARNER_A,
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      teacherId: TEACHER_ID,
      aralTeacherId: null,
      isAralLearner: true,
      deletedAt: null,
    },
    {
      id: LEARNER_B,
      schoolId: OTHER_SCHOOL_ID,
      gradeLevelId: "grade-other",
      teacherId: "teacher-x",
      aralTeacherId: null,
      isAralLearner: true,
      deletedAt: null,
    },
  ];
  m.learnerFindFirst.mockImplementation(async (a: { where: Row }) => {
    return learners.find((l) => matchesWhere(l, a.where)) ?? null;
  });
});

describe("createLearner — enrollment write", () => {
  beforeEach(() => {
    m.sectionFindMany.mockResolvedValue([
      { id: SECTION_ID, name: "Sampaguita", gradeLevelId: GRADE_ID, gradeLevel: { type: "G4" } },
    ]);
    m.learnerFindMany.mockResolvedValue([]); // no duplicate candidates
    m.txLearnerCreate.mockImplementation(async (a: { data: Row }) => ({
      id: "learner-new",
      gradeLevelId: a.data.gradeLevelId,
      sectionId: a.data.sectionId,
    }));
  });

  it("creates the learner and an ACTIVE enrollment for the active year, with exact fields", async () => {
    m.schoolYearFindFirst.mockResolvedValue({ id: YEAR_ID });

    const res = await createLearner(form({ ...sectionA, gradeLevelId: GRADE_ID }));

    expect(res).toEqual({ ok: true, data: { id: "learner-new" } });
    // Binds to: `if (activeYear) { await tx.enrollment.create({...}) }`
    expect(m.txEnrollmentCreate).toHaveBeenCalledTimes(1);
    expect(m.txEnrollmentCreate).toHaveBeenCalledWith({
      data: {
        learnerId: "learner-new",
        schoolId: SCHOOL_ID,
        schoolYearId: YEAR_ID,
        gradeLevelId: GRADE_ID,
        sectionId: SECTION_ID,
        teacherId: TEACHER_ID,
        status: "ACTIVE",
      },
    });
    // The year lookup is tenant-scoped to the active year.
    expect(firstArg(m.schoolYearFindFirst)).toEqual({
      where: { schoolId: SCHOOL_ID, isActive: true },
    });
  });

  it("writes the Learner row with the derived placement and non-ARAL defaults", async () => {
    m.schoolYearFindFirst.mockResolvedValue({ id: YEAR_ID });

    await createLearner(form({ ...sectionA, gradeLevelId: GRADE_ID }));

    // Binds to the `tx.learner.create` data block (placement from the advisory
    // section, not the payload; teacherId = the creating teacher; ARAL off).
    const data = firstArg(m.txLearnerCreate).data as Row;
    expect(data).toMatchObject({
      schoolId: SCHOOL_ID,
      gradeLevelId: GRADE_ID,
      sectionId: SECTION_ID,
      teacherId: TEACHER_ID,
      firstName: "Maria",
      lastName: "Santos",
      fullName: buildFullName("Maria", undefined, "Santos"),
      age: 9,
      isAralLearner: false,
      aralEnrolledAt: null,
    });
  });

  it("audits LEARNER_CREATE with enrollmentCreated true when a year is active", async () => {
    m.schoolYearFindFirst.mockResolvedValue({ id: YEAR_ID });

    await createLearner(form({ ...sectionA, gradeLevelId: GRADE_ID }));

    // Binds to `enrollmentCreated: Boolean(activeYear)` and the writeAudit call.
    expect(m.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEACHER_ID,
        schoolId: SCHOOL_ID,
        action: "LEARNER_CREATE",
        resource: "Learner",
        resourceId: "learner-new",
        metadata: { gradeLevelId: GRADE_ID, sectionId: SECTION_ID, enrollmentCreated: true },
      })
    );
  });

  it("creates the learner but NO enrollment when the school has no active year", async () => {
    m.schoolYearFindFirst.mockResolvedValue(null);

    const res = await createLearner(form({ ...sectionA, gradeLevelId: GRADE_ID }));

    expect(res.ok).toBe(true);
    expect(m.txLearnerCreate).toHaveBeenCalledTimes(1);
    // Binds to the `if (activeYear)` guard around enrollment.create.
    expect(m.txEnrollmentCreate).not.toHaveBeenCalled();
    expect(m.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { gradeLevelId: GRADE_ID, sectionId: SECTION_ID, enrollmentCreated: false },
      })
    );
  });

  it("returns a failure and never audits when the enrollment insert fails inside the transaction", async () => {
    m.schoolYearFindFirst.mockResolvedValue({ id: YEAR_ID });
    m.txEnrollmentCreate.mockRejectedValue(new Error("boom"));

    const res = await createLearner(form({ ...sectionA, gradeLevelId: GRADE_ID }));

    // Binds to both writes sharing the `prisma.$transaction` callback (a throw
    // there aborts the learner insert) and to audit running only after it.
    expect(res.ok).toBe(false);
    expect(m.writeAudit).not.toHaveBeenCalled();
  });

  it("writes nothing when the teacher advises no section", async () => {
    m.sectionFindMany.mockResolvedValue([]);
    m.schoolYearFindFirst.mockResolvedValue({ id: YEAR_ID });

    const res = await createLearner(form({ ...sectionA, gradeLevelId: GRADE_ID }));

    expect(res.ok).toBe(false);
    expect(m.txLearnerCreate).not.toHaveBeenCalled();
    expect(m.txEnrollmentCreate).not.toHaveBeenCalled();
  });

  it("refuses a posted grade that is not the advised section's grade, writing nothing", async () => {
    m.schoolYearFindFirst.mockResolvedValue({ id: YEAR_ID });

    const res = await createLearner(form({ ...sectionA, gradeLevelId: "some-other-grade" }));

    // Binds to the `gradeLevelId !== advisory.gradeLevelId` refusal.
    expect(res).toEqual({ ok: false, error: "You are not assigned to this grade level" });
    expect(m.txLearnerCreate).not.toHaveBeenCalled();
    expect(m.txEnrollmentCreate).not.toHaveBeenCalled();
  });
});

describe("archiveLearners — ends the enrollment", () => {
  beforeEach(() => {
    m.learnerFindMany.mockResolvedValue([
      {
        id: LEARNER_A,
        schoolId: SCHOOL_ID,
        teacherId: TEACHER_ID,
        aralTeacherId: null,
        gradeLevelId: GRADE_ID,
        isAralLearner: false,
      },
    ]);
    m.txLearnerUpdateMany.mockResolvedValue({ count: 1 });
    m.txEnrollmentUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("sets archivedAt on the learner and ARCHIVED + endedAt on the ACTIVE enrollment, same instant", async () => {
    const res = await archiveLearners(ids(LEARNER_A));

    expect(res).toEqual({ ok: true, data: { archived: 1 } });

    // Binds to `tx.learner.updateMany({... data: { archivedAt: now }})`.
    const learnerWrite = firstArg(m.txLearnerUpdateMany);
    expect(learnerWrite.where).toEqual({
      id: { in: [LEARNER_A] },
      schoolId: SCHOOL_ID,
      deletedAt: null,
      archivedAt: null,
    });
    const archivedAt = (learnerWrite.data as { archivedAt: Date }).archivedAt;
    expect(archivedAt).toBeInstanceOf(Date);

    // Binds to `tx.enrollment.updateMany({... data: { status: "ARCHIVED", endedAt: now }})`.
    expect(m.txEnrollmentUpdateMany).toHaveBeenCalledTimes(1);
    const enrollmentWrite = firstArg(m.txEnrollmentUpdateMany);
    expect(enrollmentWrite.where).toEqual({
      learnerId: { in: [LEARNER_A] },
      schoolId: SCHOOL_ID,
      status: "ACTIVE",
    });
    expect(enrollmentWrite.data).toEqual({ status: "ARCHIVED", endedAt: archivedAt });
  });

  it("audits one LEARNER_ARCHIVE row per learner", async () => {
    await archiveLearners(ids(LEARNER_A));

    // Binds to the `writeAuditMany(learners.map(...))` call.
    expect(m.writeAuditMany).toHaveBeenCalledWith([
      {
        userId: TEACHER_ID,
        schoolId: SCHOOL_ID,
        action: "LEARNER_ARCHIVE",
        resource: "Learner",
        resourceId: LEARNER_A,
        metadata: { schoolId: SCHOOL_ID, learnerId: LEARNER_A },
      },
    ]);
  });

  it("does not end any enrollment when the learner update matched fewer rows than requested", async () => {
    m.txLearnerUpdateMany.mockResolvedValue({ count: 0 });

    const res = await archiveLearners(ids(LEARNER_A));

    // Binds to `if (count !== ids.length) throw` placed before the enrollment write.
    expect(res.ok).toBe(false);
    expect(m.txEnrollmentUpdateMany).not.toHaveBeenCalled();
    expect(m.writeAuditMany).not.toHaveBeenCalled();
  });
});

describe("deleteLearners — soft delete ends the enrollment", () => {
  beforeEach(() => {
    m.learnerFindMany.mockResolvedValue([
      {
        id: LEARNER_A,
        schoolId: SCHOOL_ID,
        teacherId: TEACHER_ID,
        aralTeacherId: null,
        gradeLevelId: GRADE_ID,
        isAralLearner: false,
      },
    ]);
    m.txLearnerUpdateMany.mockResolvedValue({ count: 1 });
    m.txEnrollmentUpdateMany.mockResolvedValue({ count: 1 });
  });

  it("sets deletedAt (not archivedAt) and ARCHIVES the ACTIVE enrollment with the same endedAt", async () => {
    const res = await deleteLearners(ids(LEARNER_A));

    expect(res).toEqual({ ok: true, data: { deleted: 1 } });

    // Binds to `tx.learner.updateMany({... data: { deletedAt: now }})`.
    const learnerWrite = firstArg(m.txLearnerUpdateMany);
    expect(learnerWrite.where).toEqual({
      id: { in: [LEARNER_A] },
      schoolId: SCHOOL_ID,
      deletedAt: null,
    });
    const data = learnerWrite.data as Record<string, unknown>;
    expect(Object.keys(data)).toEqual(["deletedAt"]);
    const deletedAt = data.deletedAt as Date;
    expect(deletedAt).toBeInstanceOf(Date);

    // Binds to the enrollment.updateMany in deleteLearners ("does not keep a live seat").
    expect(m.txEnrollmentUpdateMany).toHaveBeenCalledTimes(1);
    const enrollmentWrite = firstArg(m.txEnrollmentUpdateMany);
    expect(enrollmentWrite.where).toEqual({
      learnerId: { in: [LEARNER_A] },
      schoolId: SCHOOL_ID,
      status: "ACTIVE",
    });
    expect(enrollmentWrite.data).toEqual({ status: "ARCHIVED", endedAt: deletedAt });
  });

  it("audits one LEARNER_DELETE row per learner", async () => {
    await deleteLearners(ids(LEARNER_A));

    // Binds to the `writeAuditMany` call and its LEARNER_DELETE action.
    expect(m.writeAuditMany).toHaveBeenCalledWith([
      {
        userId: TEACHER_ID,
        schoolId: SCHOOL_ID,
        action: "LEARNER_DELETE",
        resource: "Learner",
        resourceId: LEARNER_A,
        metadata: { schoolId: SCHOOL_ID, learnerId: LEARNER_A },
      },
    ]);
  });

  it("does not end any enrollment when the learner update matched fewer rows than requested", async () => {
    m.txLearnerUpdateMany.mockResolvedValue({ count: 0 });

    const res = await deleteLearners(ids(LEARNER_A));

    // Binds to `if (count !== ids.length) throw` placed before the enrollment write.
    expect(res.ok).toBe(false);
    expect(m.txEnrollmentUpdateMany).not.toHaveBeenCalled();
  });
});

describe("restoreLearner — reactivates the enrollment", () => {
  const archivedLearner = {
    id: LEARNER_A,
    schoolId: SCHOOL_ID,
    gradeLevelId: GRADE_ID,
    sectionId: SECTION_ID,
    teacherId: TEACHER_ID,
    aralTeacherId: null,
    isAralLearner: false,
    archivedAt: new Date("2026-08-01T00:00:00Z"),
    deletedAt: null,
  };

  beforeEach(() => {
    m.learnerFindFirst.mockResolvedValue(archivedLearner);
    m.txQueryRaw.mockResolvedValue([]);
    m.txEnrollmentFindFirst.mockResolvedValue(null);
    m.txSchoolYearFindFirst.mockResolvedValue({ id: YEAR_ID });
    m.txLearnerUpdate.mockResolvedValue({});
    m.txEnrollmentCreate.mockResolvedValue({ id: "enr-new" });
  });

  it("clears archivedAt AND deletedAt on the learner", async () => {
    const res = await restoreLearner(form({ id: LEARNER_A }));

    expect(res).toEqual({ ok: true });
    // Binds to `data: { archivedAt: null, deletedAt: null }`.
    expect(m.txLearnerUpdate).toHaveBeenCalledWith({
      where: { id: LEARNER_A },
      data: { archivedAt: null, deletedAt: null },
    });
  });

  it("looks the learner up by id among archived or deleted rows only", async () => {
    await restoreLearner(form({ id: LEARNER_A }));

    // Binds to the findFirst `where` (an active learner is not "restorable").
    expect(firstArg(m.learnerFindFirst)).toEqual({
      where: {
        id: LEARNER_A,
        OR: [{ archivedAt: { not: null } }, { deletedAt: { not: null } }],
      },
    });
  });

  it("revives the archived enrollment for the active year with the learner's CURRENT pointers", async () => {
    m.txEnrollmentFindFirst
      .mockResolvedValueOnce(null) // no ACTIVE row
      .mockResolvedValueOnce({ id: "enr-old" }); // ARCHIVED row for the active year
    m.txEnrollmentUpdate.mockResolvedValue({ id: "enr-old" });

    await restoreLearner(form({ id: LEARNER_A }));

    // Binds to `await reactivateEnrollment(tx, learner)` in restoreLearner.
    expect(m.txEnrollmentUpdate).toHaveBeenCalledWith({
      where: { id: "enr-old" },
      data: {
        status: "ACTIVE",
        endedAt: null,
        gradeLevelId: GRADE_ID,
        sectionId: SECTION_ID,
        teacherId: TEACHER_ID,
      },
    });
    expect(m.txEnrollmentCreate).not.toHaveBeenCalled();
  });

  it("creates a fresh ACTIVE enrollment when none exists for the active year", async () => {
    m.txEnrollmentCreate.mockResolvedValue({ id: "enr-new" });

    await restoreLearner(form({ id: LEARNER_A }));

    expect(m.txEnrollmentCreate).toHaveBeenCalledWith({
      data: {
        learnerId: LEARNER_A,
        schoolId: SCHOOL_ID,
        schoolYearId: YEAR_ID,
        gradeLevelId: GRADE_ID,
        sectionId: SECTION_ID,
        teacherId: TEACHER_ID,
        status: "ACTIVE",
      },
    });
  });

  it("leaves an existing ACTIVE enrollment alone (one ACTIVE row per learner)", async () => {
    m.txEnrollmentFindFirst.mockResolvedValue({ id: "enr-active" });

    const res = await restoreLearner(form({ id: LEARNER_A }));

    expect(res.ok).toBe(true);
    expect(m.txEnrollmentCreate).not.toHaveBeenCalled();
    expect(m.txEnrollmentUpdate).not.toHaveBeenCalled();
  });

  it("restores the learner but creates no enrollment when there is no active year", async () => {
    m.txSchoolYearFindFirst.mockResolvedValue(null);

    const res = await restoreLearner(form({ id: LEARNER_A }));

    expect(res.ok).toBe(true);
    expect(m.txLearnerUpdate).toHaveBeenCalledTimes(1);
    expect(m.txEnrollmentCreate).not.toHaveBeenCalled();
    expect(m.txEnrollmentUpdate).not.toHaveBeenCalled();
  });

  it("audits LEARNER_RESTORE", async () => {
    await restoreLearner(form({ id: LEARNER_A }));

    expect(m.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: TEACHER_ID,
        schoolId: SCHOOL_ID,
        action: "LEARNER_RESTORE",
        resourceId: LEARNER_A,
        metadata: { schoolId: SCHOOL_ID, learnerId: LEARNER_A },
      })
    );
  });

  it("refuses another school's learner and writes nothing", async () => {
    m.learnerFindFirst.mockResolvedValue({ ...archivedLearner, schoolId: OTHER_SCHOOL_ID });

    const res = await restoreLearner(form({ id: LEARNER_A }));

    // Binds to `assertSameSchool` in restoreLearner.
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(m.txLearnerUpdate).not.toHaveBeenCalled();
    expect(m.txEnrollmentCreate).not.toHaveBeenCalled();
  });

  it("refuses a learner neither advised nor tutored by the caller", async () => {
    m.learnerFindFirst.mockResolvedValue({ ...archivedLearner, teacherId: "someone-else" });

    const res = await restoreLearner(form({ id: LEARNER_A }));

    // Binds to `teacherCanAccessLearner` in restoreLearner.
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(m.txLearnerUpdate).not.toHaveBeenCalled();
  });

  describe("rows removed by a School Head / admin (deletedAt set)", () => {
    const removed = {
      ...archivedLearner,
      archivedAt: null,
      deletedAt: new Date("2026-08-02T00:00:00Z"),
    };

    it("refuses a TEACHER (even the learner's own adviser) with NOT_FOUND and writes nothing", async () => {
      m.learnerFindFirst.mockResolvedValue(removed);

      const res = await restoreLearner(form({ id: LEARNER_A }));

      expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(m.txLearnerUpdate).not.toHaveBeenCalled();
      expect(m.txEnrollmentCreate).not.toHaveBeenCalled();
      expect(m.writeAudit).not.toHaveBeenCalled();
    });

    it("lets a SCHOOL_HEAD of the same school restore it", async () => {
      m.currentUser.current = head;
      m.learnerFindFirst.mockResolvedValue(removed);

      const res = await restoreLearner(form({ id: LEARNER_A }));

      expect(res).toEqual({ ok: true });
      expect(m.txLearnerUpdate).toHaveBeenCalledWith({
        where: { id: LEARNER_A },
        data: { archivedAt: null, deletedAt: null },
      });
    });

    it("still refuses a SCHOOL_HEAD for another school's row", async () => {
      m.currentUser.current = head;
      m.learnerFindFirst.mockResolvedValue({ ...removed, schoolId: OTHER_SCHOOL_ID });

      const res = await restoreLearner(form({ id: LEARNER_A }));

      expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
      expect(m.txLearnerUpdate).not.toHaveBeenCalled();
    });

    it("a TEACHER can still restore an archived-only row of their own", async () => {
      m.learnerFindFirst.mockResolvedValue({ ...removed, deletedAt: null, archivedAt: new Date() });

      const res = await restoreLearner(form({ id: LEARNER_A }));

      expect(res).toEqual({ ok: true });
    });
  });
});

describe("updateLearner — placement and enrollment stay untouched", () => {
  const stored = {
    id: LEARNER_A,
    schoolId: SCHOOL_ID,
    gradeLevelId: GRADE_ID,
    sectionId: SECTION_ID,
    teacherId: TEACHER_ID,
    aralTeacherId: null,
    isAralLearner: false,
    governmentBenefits: ["IPS"],
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
    gradeLevel: { type: "G4" },
    deletedAt: null,
  };

  beforeEach(() => {
    m.learnerFindFirst.mockResolvedValue(stored);
    m.txLearnerUpdate.mockResolvedValue({});
  });

  const payload = (extra: Record<string, string | string[]> = {}) =>
    form({ ...sectionA, id: LEARNER_A, firstName: "Mariel", ...extra });

  it("updates Section A fields but never the grade / section / teacher / ARAL pointers", async () => {
    // A hostile or stale client posts a different section; it must be ignored.
    const res = await updateLearner(
      payload({ sectionId: "99999999-9999-4999-8999-999999999999" })
    );

    expect(res).toEqual({ ok: true });
    expect(m.txLearnerUpdate).toHaveBeenCalledTimes(1);
    const call = firstArg(m.txLearnerUpdate);
    expect(call.where).toEqual({ id: LEARNER_A });
    const data = call.data as Record<string, unknown>;

    // Binds to the field list in `tx.learner.update` ...
    expect(data).toMatchObject({
      firstName: "Mariel",
      lastName: "Santos",
      fullName: buildFullName("Mariel", undefined, "Santos"),
      age: 9,
      gender: "FEMALE",
    });
    // ... and to its deliberate omissions: adding any of these would desync the
    // Learner from its ACTIVE Enrollment.
    for (const key of [
      "gradeLevelId",
      "sectionId",
      "teacherId",
      "schoolId",
      "isAralLearner",
      "aralTeacherId",
      "archivedAt",
      "deletedAt",
    ]) {
      expect(data).not.toHaveProperty(key);
    }
  });

  it("performs no enrollment write, so the ACTIVE enrollment still matches the learner's pointers", async () => {
    await updateLearner(payload());

    // Binds to the "No enrollment write" comment block: a reintroduced reconcile fails here.
    expect(m.txEnrollmentCreate).not.toHaveBeenCalled();
    expect(m.txEnrollmentUpdate).not.toHaveBeenCalled();
    expect(m.txEnrollmentUpdateMany).not.toHaveBeenCalled();
    expect(m.txQueryRaw).not.toHaveBeenCalled();
  });

  it("audits LEARNER_UPDATE against the learner's unchanged section", async () => {
    await updateLearner(payload());

    // Binds to `sectionId = learner.sectionId` feeding the audit metadata.
    expect(m.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LEARNER_UPDATE",
        resourceId: LEARNER_A,
        metadata: { schoolId: SCHOOL_ID, learnerId: LEARNER_A, sectionId: SECTION_ID },
      })
    );
  });

  it("keeps a stored IPS flag while taking 4Ps from the form", async () => {
    await updateLearner(payload({ "governmentBenefits[]": ["FOUR_PS"] }));

    // Binds to the `governmentBenefits` merge preserving IPS.
    expect((firstArg(m.txLearnerUpdate).data as Row).governmentBenefits).toEqual([
      "FOUR_PS",
      "IPS",
    ]);
  });

  it("refuses another school's learner and writes nothing", async () => {
    m.learnerFindFirst.mockResolvedValue({ ...stored, schoolId: OTHER_SCHOOL_ID });

    const res = await updateLearner(payload());

    // Binds to `assertSameSchool` in updateLearner.
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(m.txLearnerUpdate).not.toHaveBeenCalled();
  });

  it("refuses a learner the caller neither advises nor tutors", async () => {
    m.learnerFindFirst.mockResolvedValue({ ...stored, teacherId: "someone-else" });

    const res = await updateLearner(payload());

    // Binds to `teacherCanAccessLearner` in updateLearner.
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(m.txLearnerUpdate).not.toHaveBeenCalled();
  });
});

describe("setLearnerAralTeacher", () => {
  beforeEach(() => {
    m.currentUser.current = head;
    m.learnerUpdate.mockResolvedValue({});
  });

  const assign = (learnerId: string, aralTeacherId: string) =>
    form({ learnerId, aralTeacherId });

  it("assigns an eligible teacher from the same school, notifies them and audits", async () => {
    const res = await setLearnerAralTeacher(assign(LEARNER_A, TUTOR_OK));

    expect(res).toEqual({ ok: true });
    // Binds to `prisma.learner.update({ data: { aralTeacherId: nextAralTeacherId } })`.
    expect(m.learnerUpdate).toHaveBeenCalledWith({
      where: { id: LEARNER_A },
      data: { aralTeacherId: TUTOR_OK },
    });
    // Binds to the notifyAralAssigned call.
    expect(m.notifyAralAssigned).toHaveBeenCalledWith({
      schoolId: SCHOOL_ID,
      recipientId: TUTOR_OK,
      actorId: HEAD_ID,
      learnerIds: [LEARNER_A],
    });
    // Binds to the writeAudit call (previous + next designation recorded).
    expect(m.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "LEARNER_SET_ARAL_TEACHER",
        resourceId: LEARNER_A,
        metadata: {
          schoolId: SCHOOL_ID,
          learnerId: LEARNER_A,
          previousAralTeacherId: null,
          aralTeacherId: TUTOR_OK,
        },
      })
    );
  });

  it("refuses a teacher from another school and writes nothing", async () => {
    const res = await setLearnerAralTeacher(assign(LEARNER_A, TUTOR_OTHER_SCHOOL));

    // Binds to the `isEligibleAralTutor(nextAralTeacherId, user.schoolId)` guard.
    expect(res).toMatchObject({ ok: false, error: "Teacher not found" });
    expect(m.learnerUpdate).not.toHaveBeenCalled();
    expect(m.notifyAralAssigned).not.toHaveBeenCalled();
    expect(m.writeAudit).not.toHaveBeenCalled();
    // The eligibility probe is scoped to the head's school, not just the id.
    expect(firstArg(m.userFindFirst).where).toMatchObject({
      id: TUTOR_OTHER_SCHOOL,
      schoolId: SCHOOL_ID,
    });
  });

  it("refuses a teacher id that does not exist (wrong id)", async () => {
    const res = await setLearnerAralTeacher(assign(LEARNER_A, TUTOR_UNKNOWN));

    expect(res).toMatchObject({ ok: false, error: "Teacher not found" });
    expect(m.learnerUpdate).not.toHaveBeenCalled();
    expect(m.notifyAralAssigned).not.toHaveBeenCalled();
  });

  it("refuses an inactive teacher, matching the picker's list", async () => {
    const res = await setLearnerAralTeacher(assign(LEARNER_A, TUTOR_INACTIVE));

    expect(res).toMatchObject({ ok: false, error: "Teacher not found" });
    expect(m.learnerUpdate).not.toHaveBeenCalled();
  });

  it("refuses to touch a learner from another school", async () => {
    const res = await setLearnerAralTeacher(assign(LEARNER_B, TUTOR_OK));

    // Binds to `schoolId: user.schoolId` in the learner lookup.
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(firstArg(m.learnerFindFirst).where).toMatchObject({ schoolId: SCHOOL_ID });
    expect(m.learnerUpdate).not.toHaveBeenCalled();
  });

  it("refuses to designate a tutor for a learner who is not in ARAL", async () => {
    learners[0].isAralLearner = false;

    const res = await setLearnerAralTeacher(assign(LEARNER_A, TUTOR_OK));

    // Binds to the `!learner.isAralLearner` guard.
    expect(res).toMatchObject({
      ok: false,
      error: "Enroll the learner in ARAL before assigning an ARAL teacher",
    });
    expect(m.learnerUpdate).not.toHaveBeenCalled();
  });

  it("clears the designation with an empty id, without a tutor lookup or notification", async () => {
    learners[0].aralTeacherId = TUTOR_OK;

    const res = await setLearnerAralTeacher(assign(LEARNER_A, ""));

    expect(res).toEqual({ ok: true });
    // Binds to `parsed.data.aralTeacherId === "" ? null : ...`.
    expect(m.learnerUpdate).toHaveBeenCalledWith({
      where: { id: LEARNER_A },
      data: { aralTeacherId: null },
    });
    expect(m.userFindFirst).not.toHaveBeenCalled();
    expect(m.notifyAralAssigned).not.toHaveBeenCalled();
  });

  it("is a no-op when the same teacher is already designated", async () => {
    learners[0].aralTeacherId = TUTOR_OK;

    const res = await setLearnerAralTeacher(assign(LEARNER_A, TUTOR_OK));

    // Binds to `if (learner.aralTeacherId === nextAralTeacherId) return`.
    expect(res).toEqual({ ok: true });
    expect(m.learnerUpdate).not.toHaveBeenCalled();
    expect(m.writeAudit).not.toHaveBeenCalled();
  });

  it("asks the session guard for the SCHOOL_HEAD role, not TEACHER", async () => {
    await setLearnerAralTeacher(assign(LEARNER_A, TUTOR_OK));

    // Binds to `requireSchoolUser("SCHOOL_HEAD")`: a teacher must not grant
    // themselves the designation that gives ARAL-only access.
    expect(m.roleAsked).toHaveBeenCalledWith("SCHOOL_HEAD");
  });
});
