import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `updateLearnerAsAdmin` — the Super Admin edit from the division learner
 * directory. The real `action()` wrapper, real validator and real
 * `applyLearnerProfileUpdate`; only Prisma, the guard and cache busts are faked.
 * `tx` and the global client are different objects, so a write that escapes the
 * transaction fails instead of passing silently.
 */

const LEARNER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const m = vi.hoisted(() => ({
  learnerFindFirst: vi.fn(),
  txLearnerUpdate: vi.fn(),
  requireUser: vi.fn(),
  revalidateLearnerScoped: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));
vi.mock("@/lib/prisma", () => {
  const tx = { learner: { update: (a: unknown) => m.txLearnerUpdate(a) } };
  return {
    prisma: {
      learner: { findFirst: (a: unknown) => m.learnerFindFirst(a) },
      $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    },
  };
});
vi.mock("@/lib/auth/session", () => ({
  requireUser: (role?: string) => m.requireUser(role),
}));
vi.mock("@/lib/errors/report", () => ({ reportError: vi.fn(() => "E-TEST") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateLearnerScoped: (a: unknown) => m.revalidateLearnerScoped(a),
}));

const { updateLearnerAsAdmin } = await import("@/lib/actions/admin-learner");

const superAdmin = { id: "admin-1", role: "SUPER_ADMIN", schoolId: null, adminTier: "DIVISION" };

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

/** A valid Section A payload for a Grade 4 learner (English + Filipino both collected). */
const payload = {
  id: LEARNER_ID,
  firstName: "maria",
  lastName: "santos",
  age: "9",
  gender: "FEMALE",
  nutritionalStatus: "NORMAL",
  englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
  filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
  parentEducation: "SECONDARY_GRADUATE",
};

const storedLearner = {
  id: LEARNER_ID,
  schoolId: "school-9",
  gradeLevelId: "grade-g4",
  sectionId: "section-1",
  teacherId: "teacher-1",
  aralTeacherId: null,
  englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
  filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
  governmentBenefits: ["IPS"],
  gradeLevel: { type: "GRADE_4" },
};

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.requireUser.mockResolvedValue(superAdmin);
});

describe("updateLearnerAsAdmin", () => {
  it("asks for SUPER_ADMIN and lets a redirect from the guard through", async () => {
    m.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT:/admin/login"));
    await expect(updateLearnerAsAdmin(form(payload))).rejects.toThrow("NEXT_REDIRECT:/admin/login");
    expect(m.requireUser).toHaveBeenCalledWith("SUPER_ADMIN");
    expect(m.learnerFindFirst).not.toHaveBeenCalled();
    expect(m.txLearnerUpdate).not.toHaveBeenCalled();
  });

  it("returns not found for a missing or soft-deleted learner, with no write", async () => {
    m.learnerFindFirst.mockResolvedValue(null);
    const res = await updateLearnerAsAdmin(form(payload));
    expect(res.ok).toBe(false);
    expect((res as { code?: string }).code).toBe("NOT_FOUND");
    expect(m.learnerFindFirst.mock.calls[0][0]).toMatchObject({
      where: { id: LEARNER_ID, deletedAt: null },
    });
    expect(m.txLearnerUpdate).not.toHaveBeenCalled();
  });

  it("saves the profile in any school, keeps IPS, and never moves placement", async () => {
    m.learnerFindFirst.mockResolvedValue(storedLearner);
    const res = await updateLearnerAsAdmin(form({ ...payload, sectionId: "22222222-2222-4222-8222-222222222222" }));
    expect(res).toEqual({ ok: true });

    expect(m.txLearnerUpdate).toHaveBeenCalledTimes(1);
    const arg = m.txLearnerUpdate.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(arg.where).toEqual({ id: LEARNER_ID });
    expect(arg.data).toMatchObject({
      firstName: "Maria",
      lastName: "Santos",
      fullName: "Maria Santos",
      age: 9,
      gender: "FEMALE",
      governmentBenefits: ["IPS"],
    });
    expect(arg.data).not.toHaveProperty("sectionId");
    expect(arg.data).not.toHaveProperty("gradeLevelId");
    expect(m.revalidateLearnerScoped).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: "school-9", teacherId: "teacher-1", adminDashboard: true })
    );
  });

  it("refuses an out-of-policy reading level without writing", async () => {
    m.learnerFindFirst.mockResolvedValue({ ...storedLearner, gradeLevel: { type: "KINDER" } });
    const res = await updateLearnerAsAdmin(form(payload));
    expect(res.ok).toBe(false);
    expect(m.txLearnerUpdate).not.toHaveBeenCalled();
  });
});
