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

const userUpdate = vi.fn(async (..._a: unknown[]) => ({}));

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
  // Same double for both clients: they differ only in Hyperdrive caching.
  get prismaFresh(): unknown {
    return (this as { prisma: unknown }).prisma;
  },
  prisma: {
    get $transaction() {
      return transaction;
    },
    user: {
      findFirst: (...a: unknown[]) => userFindFirst(...(a as [never])),
      update: (...a: unknown[]) => userUpdate(...a),
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

// The Test Lab check reads the impersonation session; no impersonation here.
vi.mock("@/lib/auth/impersonation-session", () => ({
  readImpersonation: vi.fn(async () => null),
  isVerifiedImpersonationOf: vi.fn(async () => false),
}));

const setRole = vi.fn();
vi.mock("@/lib/auth/identity", () => ({
  setRole: (...a: unknown[]) => setRole(...a),
}));

// `action()` records non-user failures through this; the return value is the
// reference the person is shown, and the first argument is what admins read.
const reportError = vi.fn((..._a: unknown[]) => "E-TESTREF1");
vi.mock("@/lib/errors/report", () => ({ reportError: (...a: unknown[]) => reportError(...a) }));

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

    // `revalidateSchoolHeadTeachers` now busts the school dashboard itself (see
    // `tests/unit/cache/revalidate.test.ts` for that fold, pinned against the
    // real module) so this action no longer calls `revalidateSchoolDashboard`
    // alongside it — asserting that mock here would just assert a call this
    // action never makes.
    expect(revalidateSchoolHeadTeachers).toHaveBeenCalledWith(SCHOOL_ID);
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

  it("writes nothing when the login cannot be deleted, and never returns the provider text", async () => {
    const raw = "AuthApiError: JWT secret sb_secret_9f3a is invalid for project abcd";
    deleteAuthUser.mockResolvedValue({ ok: false, error: raw });

    const res = await removeTeacher(form());

    expect(res).toMatchObject({ ok: false, code: "AUTH_PROVIDER_ERROR", ref: "E-TESTREF1" });
    expect(JSON.stringify(res)).not.toContain("sb_secret_9f3a");
    // Admins still get the raw text, in `detail`.
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "AUTH_PROVIDER_ERROR", detail: raw }),
      expect.anything()
    );
    expect(transaction).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("keeps connection-config text out of the response when the identity delete fails", async () => {
    // The Supabase service-role CONFIG_MISSING mapping is gone with Supabase;
    // the identity delete now fails as AUTH_PROVIDER_ERROR, and setup/connection
    // text must still reach admins only, never the browser.
    const raw =
      "DATABASE_URL is missing or invalid. Copy the pooled connection string into .env.local.";
    deleteAuthUser.mockResolvedValue({ ok: false, error: raw });

    const res = await removeTeacher(form());

    expect(res).toMatchObject({ ok: false, code: "AUTH_PROVIDER_ERROR", ref: "E-TESTREF1" });
    expect(JSON.stringify(res)).not.toContain("DATABASE_URL");
    expect(JSON.stringify(res)).not.toContain(".env.local");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("reports a safe error when the release fails after the login is gone", async () => {
    releaseTeacherAdvisory.mockRejectedValue(new Error('relation "Section" does not exist'));

    const res = await removeTeacher(form());

    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toContain("Section");
    // The specific half-finished state is still named, now with a reference.
    expect((res as { error: string }).error).toContain("Auth account was removed");
    expect((res as { error: string }).error).toContain("E-TESTREF1");
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

describe("clearRejectedTeacher — provider failures stay out of the response", () => {
  it("does not return the raw text when the login cannot be deleted", async () => {
    const { clearRejectedTeacher } = await import("@/lib/actions/school-head");
    const raw = "AuthApiError: JWT secret sb_secret_9f3a is invalid for project abcd";
    deleteAuthUser.mockResolvedValue({ ok: false, error: raw });

    const res = await clearRejectedTeacher(form());

    expect(res).toMatchObject({ ok: false, code: "AUTH_PROVIDER_ERROR" });
    expect(JSON.stringify(res)).not.toContain("sb_secret_9f3a");
  });
});

describe("approveTeacher — provider failures stay out of the response", () => {
  it("classifies an identity role-write error instead of returning its message", async () => {
    const { approveTeacher } = await import("@/lib/actions/school-head");
    const raw = "Database error saving identity role sb_secret_9f3a";
    teacherLookup = { ...teacherLookup!, isActive: false } as NonNullable<TeacherLookup>;
    setRole.mockRejectedValue(new Error(raw));

    const res = await approveTeacher(form());

    expect(res).toMatchObject({ ok: false });
    expect(typeof (res as { code?: string }).code).toBe("string");
    expect(JSON.stringify(res)).not.toContain("sb_secret_9f3a");
    expect(setRole).toHaveBeenCalledWith("auth-1", "TEACHER");
    // The role write fails before the User row is approved.
    expect(userUpdate).not.toHaveBeenCalled();
    expect(txUserUpdates).toHaveLength(0);
    expect(writeAudit).not.toHaveBeenCalled();
  });
});

/**
 * Deactivate/Reactivate hides the row on click and relies on the action's own
 * response (it revalidates) to re-render the roster; the table no longer calls
 * `router.refresh()`. A no-op — the teacher already has the requested state,
 * e.g. another tab got there first — must still revalidate, or the client gets
 * no fresh rows and the hidden row never comes back.
 */
describe("setTeacherActive — already in the requested state", () => {
  it("still revalidates the Teachers workspace without writing or auditing", async () => {
    const { setTeacherActive } = await import("@/lib/actions/school-head");
    teacherLookup = { ...teacherLookup!, isActive: false } as NonNullable<TeacherLookup>;
    const fd = form();
    fd.set("isActive", "false");

    const res = await setTeacherActive(fd);

    expect(res).toEqual({ ok: true });
    expect(revalidateSchoolHeadTeachers).toHaveBeenCalledWith(SCHOOL_ID);
    expect(writeAudit).not.toHaveBeenCalled();
    expect(txUserUpdates).toHaveLength(0);
  });
});
