import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Per-row removal from the Super Admin school page.
 *
 * The property these tests exist for is tenancy. These two actions are the only
 * place a Super Admin deletes named rows out of a school they are not a member
 * of, so the id list arrives from a browser and has to be treated as untrusted:
 *
 * - **Every id must belong to the school being acted on.** One foreign id
 *   refuses the whole batch — not a partial run over the ids that did match,
 *   which would delete real rows on the strength of a tampered form.
 * - **The refusal is the same generic "Not found" either way**, so a caller
 *   cannot tell "this learner is in another school" from "this learner does not
 *   exist" and use the difference to enumerate another tenant.
 * - **Nothing is written before the check passes.**
 *
 * Everything is mocked at the module boundary, matching the other action tests
 * in this directory.
 */

const schoolFindFirst = vi.fn();
const userFindMany = vi.fn();
const learnerFindMany = vi.fn();
const learnerUpdateMany = vi.fn();
const enrollmentUpdateMany = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    school: {
      get findFirst() {
        return schoolFindFirst;
      },
    },
    user: {
      get findMany() {
        return userFindMany;
      },
    },
    learner: {
      get findMany() {
        return learnerFindMany;
      },
    },
    get $transaction() {
      return transaction;
    },
  },
}));

const requireUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...a),
}));

const writeAuditMany = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAuditMany: (...a: unknown[]) => writeAuditMany(...a),
  AUDIT_ACTIONS: {
    TEACHER_REMOVE: "TEACHER_REMOVE",
    LEARNER_DELETE: "LEARNER_DELETE",
  },
}));

const checkRateLimit = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: (...a: unknown[]) => checkRateLimit(...a),
}));

const removeTeacherAccountsByIds = vi.fn();
vi.mock("@/lib/db/account-reset", () => ({
  removeTeacherAccountsByIds: (...a: unknown[]) => removeTeacherAccountsByIds(...a),
}));

vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: vi.fn(),
  revalidateSchoolDashboard: vi.fn(),
  revalidateSchoolTeachers: vi.fn(),
  revalidateSchoolsList: vi.fn(),
  revalidateTeacherCaches: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Imported after the mock factories above are registered.
const { removeSchoolLearners, removeSchoolTeachers } = await import("@/lib/actions/admin-school");

const ADMIN = { id: "admin-1", schoolId: null, role: "SUPER_ADMIN" };
const SCHOOL = { id: "6b1d0c4a-8e2f-4a7b-9c3d-1e5f7a9b0c2d", name: "Camarin Elementary School" };
const OTHER_SCHOOL = "9f8e7d6c-5b4a-4938-8271-0a1b2c3d4e5f";

const TEACHER_A = "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9";
const TEACHER_B = "2b3c4d5e-6f70-4182-93a4-b5c6d7e8f9a0";
const LEARNER_A = "3c4d5e6f-7081-4293-a4b5-c6d7e8f9a0b1";
const LEARNER_B = "4d5e6f70-8192-43a4-b5c6-d7e8f9a0b1c2";

function teacherForm(ids: string[], schoolId: string = SCHOOL.id): FormData {
  const fd = new FormData();
  fd.set("schoolId", schoolId);
  for (const id of ids) fd.append("teacherIds", id);
  return fd;
}

function learnerForm(ids: string[], schoolId: string = SCHOOL.id): FormData {
  const fd = new FormData();
  fd.set("schoolId", schoolId);
  for (const id of ids) fd.append("learnerIds", id);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue(ADMIN);
  checkRateLimit.mockResolvedValue({ ok: true });
  writeAuditMany.mockResolvedValue(undefined);
  schoolFindFirst.mockResolvedValue(SCHOOL);
  removeTeacherAccountsByIds.mockResolvedValue({ processed: 2, failed: [] });
  transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
    fn({
      learner: { updateMany: learnerUpdateMany },
      enrollment: { updateMany: enrollmentUpdateMany },
    })
  );
});

describe("removeSchoolTeachers", () => {
  it("removes the named teachers and audits one row each", async () => {
    userFindMany.mockResolvedValue([
      { id: TEACHER_A, schoolId: SCHOOL.id },
      { id: TEACHER_B, schoolId: SCHOOL.id },
    ]);

    const res = await removeSchoolTeachers(teacherForm([TEACHER_A, TEACHER_B]));

    expect(res).toEqual({ ok: true, data: { removed: 2, failed: 0 } });
    expect(removeTeacherAccountsByIds).toHaveBeenCalledWith(SCHOOL.id, [TEACHER_A, TEACHER_B]);
    const rows = writeAuditMany.mock.calls[0]?.[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      action: "TEACHER_REMOVE",
      schoolId: SCHOOL.id,
      resourceId: TEACHER_A,
    });
  });

  it("refuses the whole batch when one teacher belongs to another school", async () => {
    userFindMany.mockResolvedValue([
      { id: TEACHER_A, schoolId: SCHOOL.id },
      { id: TEACHER_B, schoolId: OTHER_SCHOOL },
    ]);

    const res = await removeSchoolTeachers(teacherForm([TEACHER_A, TEACHER_B]));

    expect(res).toEqual({ ok: false, error: "Not found" });
    expect(removeTeacherAccountsByIds).not.toHaveBeenCalled();
    expect(writeAuditMany).not.toHaveBeenCalled();
  });

  it("refuses when an id matches nothing, with the same message as a foreign id", async () => {
    userFindMany.mockResolvedValue([{ id: TEACHER_A, schoolId: SCHOOL.id }]);

    const res = await removeSchoolTeachers(teacherForm([TEACHER_A, TEACHER_B]));

    expect(res).toEqual({ ok: false, error: "Not found" });
    expect(removeTeacherAccountsByIds).not.toHaveBeenCalled();
  });

  it("refuses when the school itself is archived or gone", async () => {
    schoolFindFirst.mockResolvedValue(null);

    const res = await removeSchoolTeachers(teacherForm([TEACHER_A]));

    expect(res).toEqual({ ok: false, error: "That school no longer exists." });
    expect(userFindMany).not.toHaveBeenCalled();
  });

  it("refuses an empty selection", async () => {
    const res = await removeSchoolTeachers(teacherForm([]));

    expect(res.ok).toBe(false);
    expect(schoolFindFirst).not.toHaveBeenCalled();
  });

  it("refuses a school id that is not an id", async () => {
    const res = await removeSchoolTeachers(teacherForm([TEACHER_A], "not-a-uuid"));

    expect(res.ok).toBe(false);
    expect(schoolFindFirst).not.toHaveBeenCalled();
  });

  it("reports partial Supabase failures rather than claiming a clean run", async () => {
    userFindMany.mockResolvedValue([{ id: TEACHER_A, schoolId: SCHOOL.id }]);
    removeTeacherAccountsByIds.mockResolvedValue({
      processed: 0,
      failed: [{ id: TEACHER_A, label: "Ana", reason: "network" }],
    });

    const res = await removeSchoolTeachers(teacherForm([TEACHER_A]));

    expect(res).toEqual({ ok: true, data: { removed: 0, failed: 1 } });
  });
});

describe("removeSchoolLearners", () => {
  const rowsInSchool = [
    { id: LEARNER_A, schoolId: SCHOOL.id, teacherId: "t1", aralTeacherId: null, isAralLearner: false },
    { id: LEARNER_B, schoolId: SCHOOL.id, teacherId: "t1", aralTeacherId: null, isAralLearner: true },
  ];

  it("soft-deletes the learners and archives their active enrolments together", async () => {
    learnerFindMany.mockResolvedValue(rowsInSchool);

    const res = await removeSchoolLearners(learnerForm([LEARNER_A, LEARNER_B]));

    expect(res).toEqual({ ok: true, data: { removed: 2 } });
    expect(learnerUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: [LEARNER_A, LEARNER_B] } },
      data: { deletedAt: expect.any(Date) },
    });
    expect(enrollmentUpdateMany).toHaveBeenCalledWith({
      where: { learnerId: { in: [LEARNER_A, LEARNER_B] }, status: "ACTIVE" },
      data: { status: "ARCHIVED", endedAt: expect.any(Date) },
    });
    // One transaction, so a learner is never hidden while keeping a live seat.
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("refuses the whole batch when one learner belongs to another school", async () => {
    learnerFindMany.mockResolvedValue([
      rowsInSchool[0],
      { ...rowsInSchool[1], schoolId: OTHER_SCHOOL },
    ]);

    const res = await removeSchoolLearners(learnerForm([LEARNER_A, LEARNER_B]));

    expect(res).toEqual({ ok: false, error: "Not found" });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAuditMany).not.toHaveBeenCalled();
  });

  it("audits one row per learner, naming the school it acted on", async () => {
    learnerFindMany.mockResolvedValue(rowsInSchool);

    await removeSchoolLearners(learnerForm([LEARNER_A, LEARNER_B]));

    const rows = writeAuditMany.mock.calls[0]?.[0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      action: "LEARNER_DELETE",
      schoolId: SCHOOL.id,
      resourceId: LEARNER_A,
    });
  });

  it("collapses duplicate ids rather than counting a learner twice", async () => {
    learnerFindMany.mockResolvedValue([rowsInSchool[0]]);

    const res = await removeSchoolLearners(learnerForm([LEARNER_A, LEARNER_A]));

    expect(res).toEqual({ ok: true, data: { removed: 1 } });
  });

  it("refuses more ids than one page could hold", async () => {
    const many = Array.from(
      { length: 201 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`
    );

    const res = await removeSchoolLearners(learnerForm(many));

    expect(res.ok).toBe(false);
    expect(learnerFindMany).not.toHaveBeenCalled();
  });
});
