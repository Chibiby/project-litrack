import { beforeEach, describe, expect, it, vi } from "vitest";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/**
 * The School Head's per-row Remove on the Active / Inactive teacher tables.
 *
 * What removal does to an advisory is the point of these tests: the teacher's
 * sections go back to Unassigned and their learners are left with no adviser,
 * in the same transaction as the soft delete — so a teacher can no longer be
 * removed while still "holding" a section nobody can take over.
 *
 * `releaseTeacherAdvisory` has its own end-state tests; here it is mocked so the
 * assertions are about the action: that it calls the release inside the
 * transaction, tenant-scoped, and records what it released.
 */

const HEAD_ID = "head-1";
const SCHOOL_ID = "school-1";
const TEACHER_ID = "33333333-3333-4333-8333-333333333333";

type TeacherLookup = {
  id: string;
  authId: string;
  email: string;
  _count: { aralLearners: number };
} | null;

let teacherLookup: TeacherLookup;
let txUserUpdates: { where: { id: string }; data: Record<string, unknown> }[];
let order: string[];

const userFindFirst = vi.fn(async (args: { where: { id: string; schoolId: string } }) =>
  teacherLookup && teacherLookup.id === args.where.id && args.where.schoolId === SCHOOL_ID
    ? teacherLookup
    : null
);

const tx = {
  user: {
    update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      order.push("user.update");
      txUserUpdates.push(args);
      return {};
    }),
  },
};
const transaction = vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => {
  order.push("transaction");
  return cb(tx);
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    get $transaction() {
      return transaction;
    },
    user: {
      findFirst: (...a: unknown[]) => userFindFirst(...(a as [never])),
    },
  },
}));

const releaseTeacherAdvisory = vi.fn();
vi.mock("@/lib/teachers/release-advisory", () => ({
  releaseTeacherAdvisory: (...a: unknown[]) => releaseTeacherAdvisory(...a),
}));

const requireSchoolUser = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(),
  requireSchoolUser: (...a: unknown[]) => requireSchoolUser(...a),
}));

const writeAudit = vi.fn();
vi.mock("@/lib/audit", () => ({
  writeAudit: (...a: unknown[]) => writeAudit(...a),
  writeAuditMany: vi.fn(),
  AUDIT_ACTIONS: { TEACHER_REMOVE: "TEACHER_REMOVE" },
}));

const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => revalidatePath(...a) }));

const revalidateSchoolHeadTeachers = vi.fn();
const revalidateSchoolDashboard = vi.fn();
const revalidateTeacherCaches = vi.fn();
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolHeadTeachers: (...a: unknown[]) => revalidateSchoolHeadTeachers(...a),
  revalidateSchoolDashboard: (...a: unknown[]) => revalidateSchoolDashboard(...a),
  revalidateTeacherCaches: (...a: unknown[]) => revalidateTeacherCaches(...a),
  revalidateSchoolsList: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));

const deleteAuthUser = vi.fn();
vi.mock("@/lib/auth/delete-auth-user", () => ({
  deleteAuthUser: (...a: unknown[]) => deleteAuthUser(...a),
}));

// Imported after the mock factories above are registered.
const { removeTeacher } = await import("@/lib/actions/school-head");

function form(userId: string = TEACHER_ID): FormData {
  const fd = new FormData();
  fd.set("userId", userId);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  order = [];
  txUserUpdates = [];
  teacherLookup = {
    id: TEACHER_ID,
    authId: "auth-1",
    email: "ana.cruz@deped.gov.ph",
    _count: { aralLearners: 0 },
  };
  requireSchoolUser.mockResolvedValue({ id: HEAD_ID, schoolId: SCHOOL_ID });
  deleteAuthUser.mockResolvedValue({ ok: true });
  releaseTeacherAdvisory.mockImplementation(async () => {
    order.push("release");
    return { sectionIds: ["sec-a", "sec-b"], learnerCount: 12 };
  });
  writeAudit.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("removeTeacher", () => {
  it("removes a teacher who still advises learners, releasing the advisory", async () => {
    const res = await removeTeacher(form());

    expect(res).toEqual({ ok: true });
    expect(requireSchoolUser).toHaveBeenCalledWith("SCHOOL_HEAD");
    expect(releaseTeacherAdvisory).toHaveBeenCalledWith(tx, {
      teacherId: TEACHER_ID,
      schoolId: SCHOOL_ID,
    });
    // The release and the soft delete commit together, release first.
    expect(order).toEqual(["transaction", "release", "user.update"]);
  });

  it("soft-deletes the row and frees the email", async () => {
    await removeTeacher(form());

    expect(txUserUpdates).toHaveLength(1);
    expect(txUserUpdates[0].where).toEqual({ id: TEACHER_ID });
    expect(txUserUpdates[0].data).toMatchObject({
      isActive: false,
      deletedAt: expect.any(Date),
    });
    expect(String(txUserUpdates[0].data.email)).toMatch(
      /^ana\.cruz@deped\.gov\.ph\.deleted\.\d+$/
    );
  });

  it("audits which sections were released and how many learners lost their adviser", async () => {
    await removeTeacher(form());

    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: HEAD_ID,
        schoolId: SCHOOL_ID,
        action: "TEACHER_REMOVE",
        resource: "User",
        resourceId: TEACHER_ID,
        metadata: {
          schoolId: SCHOOL_ID,
          teacherId: TEACHER_ID,
          releasedSectionIds: ["sec-a", "sec-b"],
          learnersUnassigned: 12,
        },
      })
    );
  });

  it("refreshes the teacher tabs and the grade-levels page the freed sections show on", async () => {
    await removeTeacher(form());

    expect(revalidateSchoolHeadTeachers).toHaveBeenCalledWith(SCHOOL_ID);
    expect(revalidateSchoolDashboard).toHaveBeenCalledWith(SCHOOL_ID);
    expect(revalidateTeacherCaches).toHaveBeenCalledWith(TEACHER_ID);
    expect(revalidatePath).toHaveBeenCalledWith(SCHOOL_HEAD_ROUTES.schoolGradeLevels);
  });

  it("still refuses while the teacher is someone's designated ARAL teacher", async () => {
    teacherLookup = { ...teacherLookup!, _count: { aralLearners: 3 } };

    const res = await removeTeacher(form());

    expect(res).toEqual({
      ok: false,
      error: "Reassign 3 ARAL learner(s) to another teacher before removing this teacher.",
    });
    expect(deleteAuthUser).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("does not find a teacher from another school", async () => {
    teacherLookup = null;

    const res = await removeTeacher(form());

    expect(res).toEqual({ ok: false, error: "Teacher not found" });
    expect(deleteAuthUser).not.toHaveBeenCalled();
    expect(releaseTeacherAdvisory).not.toHaveBeenCalled();
  });

  it("writes nothing when the login cannot be deleted", async () => {
    deleteAuthUser.mockResolvedValue({ ok: false, error: "Could not delete the login." });

    const res = await removeTeacher(form());

    expect(res).toEqual({ ok: false, error: "Could not delete the login." });
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("reports a safe error when the release fails after the login is gone", async () => {
    releaseTeacherAdvisory.mockRejectedValue(new Error('relation "Section" does not exist'));

    const res = await removeTeacher(form());

    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("Section");
    expect(writeAudit).not.toHaveBeenCalled();
  });
});
