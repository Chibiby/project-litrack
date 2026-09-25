import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Page Test Lab guards (docs/test-lab-spec.md) and the pure persona helpers.
 *
 *  - assertTestableSchool refuses a non-demo, a deleted/missing, and a null
 *    school with the same generic NOT_FOUND `assertSameSchool` uses.
 *  - isTestLabSession is true only with a ticket, for this user, in a demo school.
 *  - readTestLabSession needs a BOUND ticket (not just a cookie) naming this user.
 *  - impersonationReturnPath: demo -> /admin/test-lab, else /admin/accounts.
 *  - isAllowedTestLabNext refuses anything outside the persona's role tree.
 */

const schoolFindFirst = vi.fn(async (_args: unknown): Promise<unknown> => null);
vi.mock("@/lib/prisma", () => ({ prisma: { school: { findFirst: (a: unknown) => schoolFindFirst(a) } } }));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({ auth: {} }),
}));

const readBoundImpersonationSession = vi.fn(
  async (..._args: unknown[]) => null as null | { ticket: { targetUserId: string }; expired: boolean }
);
vi.mock("@/lib/auth/impersonation", () => ({
  readBoundImpersonationSession: (...a: unknown[]) => readBoundImpersonationSession(...a),
}));

const { assertTestableSchool, isTestLabSession, readTestLabSession, impersonationReturnPath } =
  await import("@/lib/auth/test-lab");
const { assertSameSchool } = await import("@/lib/auth/tenant");
const { AppError } = await import("@/lib/errors/app-error");
const personas = await import("@/lib/test-lab/personas");
const { startTestLabSessionSchema } = await import("@/lib/validators/test-lab.schema");
const { isSyntheticEmail, schoolHeadSyntheticEmail } = await import("@/lib/auth/synthetic-email");

async function caught(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return err;
  }
}

function genericNotFoundMessage(): string {
  try {
    assertSameSchool("a", "b", "School");
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected assertSameSchool to throw");
}

beforeEach(() => {
  vi.clearAllMocks();
  schoolFindFirst.mockResolvedValue(null);
  readBoundImpersonationSession.mockResolvedValue(null);
});

describe("assertTestableSchool", () => {
  it("passes for a live demo school, and looks it up with deletedAt: null", async () => {
    schoolFindFirst.mockResolvedValue({ isDemo: true });
    await expect(assertTestableSchool("school-demo")).resolves.toBeUndefined();
    expect(schoolFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "school-demo", deletedAt: null } })
    );
  });

  it("refuses a real (non-demo) school with the generic not-found", async () => {
    schoolFindFirst.mockResolvedValue({ isDemo: false });
    const err = await caught(assertTestableSchool("school-real"));
    expect(err?.code).toBe("NOT_FOUND");
    expect(err?.message).toBe(genericNotFoundMessage());
    expect(err?.message).not.toContain("school-real");
  });

  it("refuses a deleted or missing school with the same message", async () => {
    // deletedAt: null is in the where, so a deleted school is not found.
    schoolFindFirst.mockResolvedValue(null);
    const deleted = await caught(assertTestableSchool("school-deleted"));
    schoolFindFirst.mockResolvedValue({ isDemo: false });
    const real = await caught(assertTestableSchool("school-real"));
    expect(deleted?.code).toBe("NOT_FOUND");
    expect(deleted?.message).toBe(real?.message);
  });

  it("refuses a null school id without querying", async () => {
    const err = await caught(assertTestableSchool(null));
    expect(err?.code).toBe("NOT_FOUND");
    expect(schoolFindFirst).not.toHaveBeenCalled();
  });
});

describe("isTestLabSession", () => {
  it("is false with no ticket", () => {
    expect(isTestLabSession({ ticketTargetUserId: null, userId: "u1", schoolIsDemo: true })).toBe(false);
    expect(isTestLabSession({ ticketTargetUserId: undefined, userId: "u1", schoolIsDemo: true })).toBe(false);
    expect(isTestLabSession({ ticketTargetUserId: "", userId: "", schoolIsDemo: true })).toBe(false);
  });

  it("is false with a ticket for another user", () => {
    expect(isTestLabSession({ ticketTargetUserId: "u2", userId: "u1", schoolIsDemo: true })).toBe(false);
  });

  it("is false with a ticket for this user in a non-demo school", () => {
    expect(isTestLabSession({ ticketTargetUserId: "u1", userId: "u1", schoolIsDemo: false })).toBe(false);
  });

  it("is true only when all hold", () => {
    expect(isTestLabSession({ ticketTargetUserId: "u1", userId: "u1", schoolIsDemo: true })).toBe(true);
  });
});

describe("readTestLabSession", () => {
  // Distinct ids per case: the inner reader is React cache()'d.
  it("is false without a bound ticket, and never reads the school", async () => {
    readBoundImpersonationSession.mockResolvedValue(null);
    expect(await readTestLabSession({ id: "r1", schoolId: "s1" })).toBe(false);
    expect(schoolFindFirst).not.toHaveBeenCalled();
  });

  it("is false when the bound ticket names another user", async () => {
    readBoundImpersonationSession.mockResolvedValue({ ticket: { targetUserId: "someone-else" }, expired: false });
    schoolFindFirst.mockResolvedValue({ isDemo: true });
    expect(await readTestLabSession({ id: "r2", schoolId: "s2" })).toBe(false);
  });

  it("is false for a bound ticket in a non-demo school", async () => {
    readBoundImpersonationSession.mockResolvedValue({ ticket: { targetUserId: "r3" }, expired: false });
    schoolFindFirst.mockResolvedValue({ isDemo: false });
    expect(await readTestLabSession({ id: "r3", schoolId: "s3" })).toBe(false);
  });

  it("is true for a bound ticket naming this user in a demo school", async () => {
    readBoundImpersonationSession.mockResolvedValue({ ticket: { targetUserId: "r4" }, expired: false });
    schoolFindFirst.mockResolvedValue({ isDemo: true });
    expect(await readTestLabSession({ id: "r4", schoolId: "s4" })).toBe(true);
  });

  it("is false for a school-less user", async () => {
    readBoundImpersonationSession.mockResolvedValue({ ticket: { targetUserId: "r5" }, expired: false });
    expect(await readTestLabSession({ id: "r5", schoolId: null })).toBe(false);
  });
});

describe("impersonationReturnPath", () => {
  it("returns demo sessions to Test Lab and everything else to the accounts console", () => {
    expect(impersonationReturnPath({ targetSchoolIsDemo: true })).toBe("/admin/test-lab");
    expect(impersonationReturnPath({ targetSchoolIsDemo: false })).toBe("/admin/accounts");
  });

  it("returns a real-account session Test Lab started (signed returnTo) to Test Lab", () => {
    expect(impersonationReturnPath({ targetSchoolIsDemo: false, returnTo: "test-lab" })).toBe(
      "/admin/test-lab"
    );
  });
});

describe("Test Lab personas", () => {
  it("uses the demo School Head's existing synthetic address for head", () => {
    expect(personas.testLabPersonaEmail("head")).toBe(schoolHeadSyntheticEmail("demo-1-123456"));
  });

  it("gives teachers distinct, synthetic @school.local addresses that no real teacher username can take", () => {
    const teacher = personas.testLabPersonaEmail("teacher");
    const pending = personas.testLabPersonaEmail("pending-teacher");
    expect(teacher).toBe("testlab.teacher.demo-1-123456@school.local");
    expect(pending).toBe("testlab.pending.demo-1-123456@school.local");
    expect(teacher).not.toBe(pending);
    for (const email of [teacher, pending]) {
      expect(isSyntheticEmail(email)).toBe(true);
      expect(email.startsWith("teacher.")).toBe(false);
    }
  });

  it("maps personas to roles and role homes", () => {
    expect(personas.testLabPersonaRole("head")).toBe("SCHOOL_HEAD");
    expect(personas.testLabPersonaRole("teacher")).toBe("TEACHER");
    expect(personas.testLabPersonaRole("pending-teacher")).toBe("TEACHER");
    expect(personas.testLabRoleHome("head")).toBe("/school-head");
    expect(personas.testLabRoleHome("pending-teacher")).toBe("/teacher");
  });

  it.each([
    ["head", "/school-head"],
    ["head", "/school-head/learners"],
    ["head", "/school-head?schoolYear=1"],
    ["teacher", "/teacher/aral/profiling"],
  ] as const)("allows %s -> %s", (persona, next) => {
    expect(personas.isAllowedTestLabNext(persona, next)).toBe(true);
  });

  it.each([
    ["head", "/teacher"],
    ["teacher", "/school-head"],
    ["teacher", "/teachers"],
    ["teacher", "/admin"],
    ["teacher", "/teacher/../admin"],
    ["teacher", "/teacher/../school-head/settings"],
    ["teacher", "/teacher/%2e%2e/admin"],
    ["teacher", "/teacher/%2fadmin"],
    ["head", "/school-head/../admin"],
    ["teacher", "//evil.example"],
    ["teacher", "/teacher//evil.example"],
    ["teacher", "/teacher/\\evil.example"],
    ["teacher", "https://evil.example/teacher"],
    ["teacher", "javascript:alert(1)"],
    ["teacher", "teacher"],
    ["teacher", "/teacher/\nx"],
    ["teacher", ""],
  ] as const)("refuses %s -> %j", (persona, next) => {
    expect(personas.isAllowedTestLabNext(persona, next)).toBe(false);
    expect(personas.resolveTestLabNext(persona, next)).toBe(personas.testLabRoleHome(persona));
  });
});

describe("startTestLabSessionSchema", () => {
  it("accepts the three personas and an optional next", () => {
    for (const persona of ["head", "teacher", "pending-teacher"]) {
      expect(startTestLabSessionSchema.safeParse({ persona }).success).toBe(true);
    }
    expect(startTestLabSessionSchema.safeParse({ persona: "head", next: "/school-head" }).success).toBe(true);
  });

  it("rejects anything else", () => {
    expect(startTestLabSessionSchema.safeParse({ persona: "SUPER_ADMIN" }).success).toBe(false);
    expect(startTestLabSessionSchema.safeParse({}).success).toBe(false);
    expect(startTestLabSessionSchema.safeParse({ persona: "head", next: 5 }).success).toBe(false);
  });
});
