import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `impersonateUser`, `endImpersonation`, `logoutAction`, `resetTeacherPassword`
 * and `getAccountProfile` — the console's highest-severity surface, because
 * three of them either mint a session for another account or restore one.
 *
 * What is pinned here, one line each:
 *  - impersonateUser refuses before any read/write for a non-Super-Admin caller.
 *  - impersonateUser refuses a SUPER_ADMIN target (the escalation guard).
 *  - impersonateUser refuses a soft-deleted target.
 *  - impersonateUser refuses an inactive, approved target, BEFORE the swap.
 *  - impersonateUser allows a PENDING teacher even though isActive is false.
 *  - impersonateUser refuses a REJECTED target by name, even if isActive were true.
 *  - the Better Auth impersonation is started for the target's own authId.
 *  - audit metadata for IMPERSONATION_START is ids, school name and role only.
 *  - endImpersonation refuses a session that is not an impersonation (no
 *    server-side `impersonatedBy`) — the re-login-as-target-then-return scenario.
 *  - endImpersonation refuses when there is no current session.
 *  - endImpersonation keeps the admin cookies when stopping fails.
 *  - endImpersonation stops the impersonation session on success, and a
 *    failed stop is reported and never audited as an end.
 *  - endImpersonation still refuses a demoted / inactive / deleted admin row.
 *  - logoutAction clears the impersonation cookies only after the session end.
 *  - logoutAction ends only the impersonated session (no global revoke) for a
 *    proven impersonation.
 *  - logoutAction revokes every session for an ordinary one.
 *  - resetTeacherPassword refuses a non-Super-Admin caller.
 *  - resetTeacherPassword refuses a non-TEACHER target.
 *  - resetTeacherPassword's update payload is exactly the four documented
 *    fields, with no `isActive` key at all.
 *  - resetTeacherPassword never puts the credential in audit metadata.
 *  - getAccountProfile refuses a non-Super-Admin caller.
 *  - getAccountProfile's advisory/aral are null for a non-teacher, and the
 *    query count for that shape is bounded (3 calls: user + 2 in Promise.all).
 *  - impersonateUser allows a DISTRICT_ADMIN target for a Super Admin and lands
 *    on /district; a SUPER_ADMIN target is still refused, and the caller must
 *    be a Super Admin (I14, T13, district-admin spec).
 *  - resetDistrictAdminPassword: Super-Admin-only, sets mustChangePassword,
 *    writes a bcrypt hash with identity role DISTRICT_ADMIN in one transaction,
 *    and never leaks the credential.
 *
 * Everything below the auth line is mocked to leaf infrastructure only, in the
 * style of the other files in this directory.
 */

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_AUTH_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const SCHOOL_ID = "44444444-4444-4444-8444-444444444444";
const TARGET_AUTH_ID = "auth-target-1";

// ── requireUser ──────────────────────────────────────────────────────────
const requireUser = vi.fn(async () => ({ id: ADMIN_ID, authId: ADMIN_AUTH_ID, role: "SUPER_ADMIN" }));
// Delegates to `requireUser` so its per-test refusals still apply.
const requireDeveloperAdmin = vi.fn((..._a: unknown[]) => requireUser());
vi.mock("@/lib/auth/session", () => ({
  requireUser: (...a: unknown[]) => requireUser(...(a as [])),
  // Tier is covered in tests/unit/auth/developer-admin-guard.test.ts.
  requireDeveloperAdmin: (...a: unknown[]) => requireDeveloperAdmin(...a),
}));

/**
 * Honors a `where.role` filter against `targetRow.role`, so the new
 * `impersonateUser` allow-list (`role: { in: IMPERSONATABLE_ROLES }`,
 * docs/specs/district-admin.md I14) is actually exercised: deleting that
 * filter from the action would let a DISTRICT_ADMIN `targetRow` through this
 * fake and reach `startImpersonation`, turning the NOT_FOUND test below red.
 * Every test in this file that needs a different row overrides with
 * `mockResolvedValueOnce`, which takes priority over this default and is
 * untouched by the filter added here.
 */
function matchesRoleWhere(role: string, where: unknown): boolean {
  const roleFilter = (where as { role?: unknown } | undefined)?.role;
  if (roleFilter === undefined) return true;
  if (typeof roleFilter === "string") return roleFilter === role;
  if (typeof roleFilter === "object" && roleFilter !== null && "in" in roleFilter) {
    const list = (roleFilter as { in?: unknown }).in;
    return Array.isArray(list) && list.includes(role);
  }
  return true;
}

// ── prisma ───────────────────────────────────────────────────────────────
const prismaMock = {
  user: {
    findFirst: vi.fn(async (args: { where?: unknown } = {}): Promise<unknown> => {
      if (!targetRow) return null;
      return matchesRoleWhere(targetRow.role, args.where) ? targetRow : null;
    }),
    findUnique: vi.fn(async (_args: unknown): Promise<unknown> => null),
    update: vi.fn(async (_args: unknown) => ({})),
  },
  school: {
    findFirst: vi.fn(async (_args: unknown): Promise<unknown> => null),
  },
  auditLog: {
    groupBy: vi.fn(async (_args: unknown) => []),
    findFirst: vi.fn(async (_args: unknown): Promise<unknown> => null),
    findMany: vi.fn(async (_args: unknown) => []),
  },
  $queryRaw: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => [
    { attendanceAt: null, readingLevelAt: null, termGradesAt: null },
  ]),
  learner: {
    groupBy: vi.fn(async (_args: unknown) => []),
    count: vi.fn(async (_args: unknown) => 0),
  },
};
// The credential writes run in `prismaFresh.$transaction`; the callback gets
// `prismaMock` as `tx`, so `prismaMock.user.update` records the in-transaction write.
const prismaWithTx = {
  ...prismaMock,
  $transaction: vi.fn(async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock)),
};
vi.mock("@/lib/prisma", () => ({ prisma: prismaWithTx, prismaFresh: prismaWithTx }));

// ── rate limit ───────────────────────────────────────────────────────────
const checkRateLimit = vi.fn(async () => ({ ok: true, retryAfterMs: 0 }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...(a as [])) }));

// ── audit ────────────────────────────────────────────────────────────────
const writeAudit = vi.fn(async (_e: Record<string, unknown>) => {});
vi.mock("@/lib/audit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/audit")>("@/lib/audit");
  return { AUDIT_ACTIONS: actual.AUDIT_ACTIONS, writeAudit: (e: Record<string, unknown>) => writeAudit(e) };
});

// ── identity writes (Better Auth rows in Neon) ───────────────────────────
const setPassword = vi.fn(async (..._args: unknown[]) => {});
const setRole = vi.fn(async (..._args: unknown[]) => {});
vi.mock("@/lib/auth/identity", () => ({ setPassword, setRole }));

// ── Better Auth session + impersonation modules ──────────────────────────
type FakeSession = {
  user: { id: string };
  session: { impersonatedBy: string | null };
};

const getAuthSession = vi.fn(async (..._args: unknown[]) => null as null | FakeSession);
const endCurrentSession = vi.fn(async (..._args: unknown[]) => true);
const revokeAllSessions = vi.fn(async (..._args: unknown[]) => 1);
vi.mock("@/lib/auth/auth-session", () => ({
  getAuthSession: (...a: unknown[]) => getAuthSession(...a),
  endCurrentSession: (...a: unknown[]) => endCurrentSession(...a),
  revokeAllSessions: (...a: unknown[]) => revokeAllSessions(...a),
  signInWithPassword: vi.fn(),
}));

const startImpersonationSession = vi.fn(async (..._args: unknown[]) => {});
const stopImpersonationSession = vi.fn(async (..._args: unknown[]) => {});
const expireImpersonationCookies = vi.fn(async (..._args: unknown[]) => {});
const readImpersonation = vi.fn(async (..._args: unknown[]) => null as null | Record<string, unknown>);
vi.mock("@/lib/auth/impersonation-session", () => ({
  startImpersonationSession: (...a: unknown[]) => startImpersonationSession(...a),
  stopImpersonationSession: (...a: unknown[]) => stopImpersonationSession(...a),
  expireImpersonationCookies: (...a: unknown[]) => expireImpersonationCookies(...a),
  readImpersonation: (...a: unknown[]) => readImpersonation(...a),
  isVerifiedImpersonationOf: vi.fn(async () => false),
}));
// `logoutAction` pulls in the rest of the sign-in module; none of it runs here
// and the real ones reach for Better Auth, cookies() or the network.
vi.mock("@/lib/auth/login-gates", () => ({
  assertAuthConfigured: vi.fn(),
  requireActiveSchool: vi.fn(),
  LOGIN_RATE: { limit: 10, windowMs: 300_000 },
}));
vi.mock("@/lib/auth/lookup-throttle", () => ({
  assertLookupAllowed: vi.fn(),
  recordFailedLookup: vi.fn(),
}));
vi.mock("@/lib/auth/last-login", () => ({ recordLastLogin: vi.fn() }));
vi.mock("@/lib/auth/password-reset", () => ({ consumeResetToken: vi.fn(), peekResetToken: vi.fn() }));
vi.mock("@/lib/auth/recovery-email", () => ({
  RESET_COOKIE: "litrack_reset",
  RESET_COOKIE_PATH: "/auth",
  sendPasswordRecoveryEmail: vi.fn(),
  hasRecentRecoveryToken: vi.fn(),
}));
vi.mock("@/lib/auth/teacher-registration", () => ({ completeTeacherAuthAfterVerify: vi.fn() }));
vi.mock("@/lib/auth/warm-routes", () => ({
  warmAdminRoutes: vi.fn(),
  warmDistrictRoutes: vi.fn(),
  warmSchoolHeadRoutes: vi.fn(),
  warmTeacherRoutes: vi.fn(),
}));

// Signing out also ends any demo session in the browser. Stubbed because the
// real one reaches for `cookies()`, which does not exist outside a request.
const clearDemoSessionCookie = vi.fn(async () => {});
vi.mock("@/lib/demo/session", () => ({
  clearDemoSessionCookie: (...a: unknown[]) => clearDemoSessionCookie(...(a as [])),
}));

// ── errors / navigation / cache ───────────────────────────────────────────
const reportError = vi.fn(() => "E-TESTREF00");
vi.mock("@/lib/errors/report", () => ({ reportError: (...a: unknown[]) => reportError(...(a as [])) }));

const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({
  redirect: (path: string) => redirect(path),
  unstable_rethrow: (err: unknown) => {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) throw err;
  },
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/cache/revalidate", () => ({
  revalidateSchoolsList: vi.fn(),
  revalidateAdminAccountPages: vi.fn(),
}));

// ── the module under test ────────────────────────────────────────────────
const { impersonateUser, endImpersonation, resetTeacherPassword, resetDistrictAdminPassword,
  getAccountProfile, revealSchoolHeadPassword, resetSchoolHeadPasswordToDefault,
  startTestLabSession } = await import(
  "@/lib/actions/accounts"
);
const { logoutAction } = await import("@/lib/actions/auth");
const { AUDIT_ACTIONS } = await import("@/lib/audit");
const { AppError } = await import("@/lib/errors/app-error");
const { isBcryptHash, verifyPassword } = await import("@/lib/auth/password-hash");

type TargetRow = {
  id: string;
  authId: string;
  role: string;
  isActive: boolean;
  approvalStatus: string | null;
  email: string;
  schoolId: string | null;
  fullName: string;
  school: { name: string } | null;
} | null;

let targetRow: TargetRow = null;

function teacher(overrides: Partial<NonNullable<TargetRow>> = {}): TargetRow {
  return {
    id: TARGET_ID,
    authId: TARGET_AUTH_ID,
    role: "TEACHER",
    isActive: true,
    approvalStatus: "APPROVED",
    email: "t@school.local",
    schoolId: SCHOOL_ID,
    fullName: "Some Teacher",
    school: { name: "Sample ES" },
    ...overrides,
  };
}

function form(userId: string = TARGET_ID): FormData {
  const fd = new FormData();
  fd.set("userId", userId);
  return fd;
}

/** Runs an action that redirects on success, swallowing the marker throw. */
async function run<T>(p: Promise<T>): Promise<T | { redirectedTo: string }> {
  try {
    return await p;
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) {
      return { redirectedTo: err.message.slice("NEXT_REDIRECT:".length) };
    }
    throw err;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getAuthSession.mockResolvedValue(null);
  endCurrentSession.mockResolvedValue(true);
  revokeAllSessions.mockResolvedValue(1);
  startImpersonationSession.mockResolvedValue(undefined);
  stopImpersonationSession.mockResolvedValue(undefined);
  expireImpersonationCookies.mockResolvedValue(undefined);
  readImpersonation.mockResolvedValue(null);
  setPassword.mockResolvedValue(undefined);
  setRole.mockResolvedValue(undefined);
  requireUser.mockResolvedValue({ id: ADMIN_ID, authId: ADMIN_AUTH_ID, role: "SUPER_ADMIN" });
  checkRateLimit.mockResolvedValue({ ok: true, retryAfterMs: 0 });
  targetRow = teacher();
  prismaMock.user.findFirst.mockImplementation(async (args: { where?: unknown } = {}) => {
    if (!targetRow) return null;
    return matchesRoleWhere(targetRow.role, args.where) ? targetRow : null;
  });
  prismaMock.school.findFirst.mockResolvedValue(null);
  prismaMock.user.findUnique.mockResolvedValue(null);
  redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe("impersonateUser", () => {
  it("refuses a non-Super-Admin caller before any read or write", async () => {
    requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login"));
    await expect(impersonateUser(form())).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(startImpersonationSession).not.toHaveBeenCalled();
  });

  it("gates the caller on SUPER_ADMIN alone — a district admin caller is refused (T13)", async () => {
    // Stand-in for the real `requireUser`: only a SUPER_ADMIN passes a
    // "SUPER_ADMIN" gate; a signed-in DISTRICT_ADMIN is sent home. If the
    // action's gate were widened (or dropped), this caller would get through.
    requireUser.mockImplementationOnce(async (...args: unknown[]) => {
      const roles = args[0];
      const allowed = roles === undefined ? null : Array.isArray(roles) ? roles : [roles];
      if (allowed && !allowed.includes("DISTRICT_ADMIN")) throw new Error("NEXT_REDIRECT:/district");
      return { id: "da-caller", authId: "da-caller-auth", role: "DISTRICT_ADMIN" };
    });
    targetRow = teacher({ role: "DISTRICT_ADMIN", schoolId: null, school: null });
    await expect(impersonateUser(form())).rejects.toThrow("NEXT_REDIRECT:/district");
    expect(requireUser).toHaveBeenCalledWith("SUPER_ADMIN");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(startImpersonationSession).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("refuses a SUPER_ADMIN target — now via the impersonatable-role allow-list (I14)", async () => {
    // Behaviour change from the pre-district-admin action: the allow-list
    // (`role: { in: IMPERSONATABLE_ROLES }`) is now IN the target lookup's
    // `where`, so a SUPER_ADMIN id is simply not found — the same generic
    // refusal as any other disallowed role — rather than reaching
    // `startImpersonation`'s own privilege-escalation guard. That guard is
    // still there (see `matchesRoleWhere`'s doc comment above): if this
    // allow-list were ever deleted from the action, a SUPER_ADMIN target
    // would still be caught by it and this test would fail on the wrong code
    // (AUTH_FORBIDDEN, not NOT_FOUND) rather than passing by coincidence.
    targetRow = teacher({ role: "SUPER_ADMIN" });
    const res = await impersonateUser(form());
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(startImpersonationSession).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("signs a Super Admin in as a DISTRICT_ADMIN and lands on /district — I14, T13", async () => {
    // DISTRICT_ADMIN is on the allow-list, so the lookup finds the row (the
    // fake honours `role: { in: [...] }`) and the session lands on the
    // district portal, never on `/school-head`. Dropping DISTRICT_ADMIN from
    // the allow-list turns this into NOT_FOUND; a hard-coded head/teacher
    // redirect turns the destination wrong.
    targetRow = teacher({ role: "DISTRICT_ADMIN", schoolId: null, school: null, approvalStatus: null });
    const res = await run(impersonateUser(form()));
    expect(res).toEqual({ redirectedTo: "/district" });
    const where = (prismaMock.user.findFirst.mock.calls[0][0] as { where: { role: { in: string[] } } }).where;
    expect(where.role.in).toContain("DISTRICT_ADMIN");
    expect(where.role.in).not.toContain("SUPER_ADMIN");
    expect(startImpersonationSession).toHaveBeenCalledTimes(1);
    expect(startImpersonationSession).toHaveBeenCalledWith({ targetAuthId: TARGET_AUTH_ID });
    const entry = writeAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      userId: ADMIN_ID,
      schoolId: null,
      action: AUDIT_ACTIONS.IMPERSONATION_START,
      resourceId: TARGET_ID,
      metadata: { schoolId: null, schoolName: null, targetRole: "DISTRICT_ADMIN" },
    });
  });

  it("passes returnTo=test-lab to the session start only when asked, and refuses any other value", async () => {
    await run(impersonateUser(form()));
    expect(startImpersonationSession.mock.calls[0][0]).not.toHaveProperty("returnTo");

    vi.clearAllMocks();
    const fd = form();
    fd.set("returnTo", "test-lab");
    await run(impersonateUser(fd));
    expect(startImpersonationSession).toHaveBeenCalledWith(
      expect.objectContaining({ targetAuthId: TARGET_AUTH_ID, returnTo: "test-lab" })
    );

    vi.clearAllMocks();
    const bad = form();
    bad.set("returnTo", "https://evil.example");
    expect(await impersonateUser(bad)).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(startImpersonationSession).not.toHaveBeenCalled();
  });

  it("still refuses an inactive DISTRICT_ADMIN target before the swap", async () => {
    targetRow = teacher({ role: "DISTRICT_ADMIN", schoolId: null, school: null, approvalStatus: null, isActive: false });
    const res = await impersonateUser(form());
    expect(res).toMatchObject({ ok: false, code: "ADMIN_IMPERSONATE_INACTIVE" });
    expect(startImpersonationSession).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("refuses a soft-deleted target (excluded by the findFirst where, so it is simply not found)", async () => {
    // deletedAt: null is baked into the `where`; a soft-deleted row never
    // reaches the handler, so the mock returns null exactly as Prisma would.
    targetRow = null;
    const res = await impersonateUser(form());
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(startImpersonationSession).not.toHaveBeenCalled();
  });

  it("refuses an inactive, approved target BEFORE the session is installed or the ticket written", async () => {
    targetRow = teacher({ isActive: false, approvalStatus: "APPROVED" });
    const res = await impersonateUser(form());
    expect(res).toMatchObject({ ok: false, code: "ADMIN_IMPERSONATE_INACTIVE" });
    expect(startImpersonationSession).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("allows a PENDING teacher even though isActive is false", async () => {
    targetRow = teacher({ isActive: false, approvalStatus: "PENDING" });
    const res = await run(impersonateUser(form()));
    expect(res).toEqual({ redirectedTo: "/teacher" });
    expect(startImpersonationSession).toHaveBeenCalledTimes(1);
  });

  it("refuses a REJECTED target by name, even if isActive were somehow true", async () => {
    targetRow = teacher({ isActive: true, approvalStatus: "REJECTED" });
    const res = await impersonateUser(form());
    expect(res).toMatchObject({ ok: false, code: "ADMIN_IMPERSONATE_INACTIVE" });
    expect(startImpersonationSession).not.toHaveBeenCalled();
  });

  it("starts the Better Auth impersonation for the target's own authId, and nothing else", async () => {
    await run(impersonateUser(form()));
    expect(startImpersonationSession).toHaveBeenCalledTimes(1);
    expect(startImpersonationSession).toHaveBeenCalledWith({ targetAuthId: TARGET_AUTH_ID });
    // Signing in as someone never touches their credential.
    expect(setPassword).not.toHaveBeenCalled();
    expect(setRole).not.toHaveBeenCalled();
  });

  it("maps a target with no sign-in identity to AUTH_PROVIDER_ERROR and writes no audit row", async () => {
    startImpersonationSession.mockRejectedValueOnce(
      new AppError("IDENTITY_NOT_FOUND", { detail: "no identity" })
    );
    const res = await impersonateUser(form());
    expect(res).toMatchObject({ ok: false, code: "AUTH_PROVIDER_ERROR" });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses a School Head who is not the school's sign-in head", async () => {
    targetRow = teacher({ role: "SCHOOL_HEAD" });
    // The sign-in-head lookup (second findFirst) resolves to a different, older head.
    prismaMock.user.findFirst
      .mockResolvedValueOnce(targetRow)
      .mockResolvedValueOnce({ id: "older-head", authId: "a", email: "e", schoolId: SCHOOL_ID });
    const res = await impersonateUser(form());
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(startImpersonationSession).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("writes IMPERSONATION_START audit metadata as ids, school name and role only", async () => {
    await run(impersonateUser(form()));
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      userId: ADMIN_ID,
      schoolId: SCHOOL_ID,
      action: AUDIT_ACTIONS.IMPERSONATION_START,
      resource: "User",
      resourceId: TARGET_ID,
      metadata: { schoolId: SCHOOL_ID, schoolName: "Sample ES", targetRole: "TEACHER" },
    });
    // No email, no full name, no password material.
    expect(JSON.stringify(entry)).not.toContain("t@school.local");
    expect(JSON.stringify(entry)).not.toContain("Some Teacher");
  });

  it("regression: still signs in as a real (non-demo) account, with no demo check applied", async () => {
    // A real school: Test Lab's guard would refuse it, so it must not be on this path.
    prismaMock.school.findFirst.mockResolvedValue({ isDemo: false });
    const res = await run(impersonateUser(form()));
    expect(res).toEqual({ redirectedTo: "/teacher" });
    expect(prismaMock.school.findFirst).not.toHaveBeenCalled();
    expect(startImpersonationSession).toHaveBeenCalledWith({ targetAuthId: TARGET_AUTH_ID });
    const entry = writeAudit.mock.calls[0][0] as { metadata: Record<string, unknown> };
    expect(entry.metadata).not.toHaveProperty("source");
  });
});

describe("startTestLabSession", () => {
  function labForm(fields: Record<string, string> = {}): FormData {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ persona: "teacher", ...fields })) fd.set(k, v);
    return fd;
  }

  it("refuses a non-Super-Admin caller before any read or write", async () => {
    requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login"));
    await expect(startTestLabSession(labForm())).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(requireDeveloperAdmin).toHaveBeenCalledWith("Page Test Lab");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.school.findFirst).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(startImpersonationSession).not.toHaveBeenCalled();
  });

  it("refuses an unknown persona", async () => {
    const res = await startTestLabSession(labForm({ persona: "SUPER_ADMIN" }));
    expect(res).toMatchObject({ ok: false, code: "VALIDATION_FAILED" });
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("looks the persona up by its synthetic email inside a live demo school only", async () => {
    prismaMock.school.findFirst.mockResolvedValue({ isDemo: true });
    await run(startTestLabSession(labForm()));
    const args = prismaMock.user.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(args.where).toMatchObject({
      email: "testlab.teacher.demo-1-123456@school.local",
      role: "TEACHER",
      deletedAt: null,
      school: { isDemo: true, deletedAt: null },
    });
  });

  it("refuses a persona account whose school is not demo: no impersonation started", async () => {
    // Belt and braces: even if the lookup returned a row, the school re-check refuses.
    prismaMock.school.findFirst.mockResolvedValue({ isDemo: false });
    const res = await startTestLabSession(labForm());
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(setPassword).not.toHaveBeenCalled();
    expect(startImpersonationSession).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("tells the admin to prepare test data when no demo persona exists, minting nothing", async () => {
    targetRow = null;
    const res = await startTestLabSession(labForm());
    expect(res).toMatchObject({ ok: false, code: "TEST_LAB_NOT_PREPARED" });
    expect(setPassword).not.toHaveBeenCalled();
    expect(startImpersonationSession).not.toHaveBeenCalled();
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("shares impersonateUser's rate-limit bucket", async () => {
    checkRateLimit.mockResolvedValueOnce({ ok: false, retryAfterMs: 60_000 });
    const res = await startTestLabSession(labForm());
    expect(res).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    expect(checkRateLimit).toHaveBeenCalledWith(`impersonate:${ADMIN_ID}`, expect.anything());
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it.each(["//evil.example", "https://evil.example/teacher", "/school-head/learners", "/teacher\\..\\admin"])(
    "falls back to the role home for unsafe next %j",
    async (next) => {
      prismaMock.school.findFirst.mockResolvedValue({ isDemo: true });
      const res = await run(startTestLabSession(labForm({ next })));
      expect(res).toEqual({ redirectedTo: "/teacher" });
    }
  );

  it("honours a safe next inside the persona's role tree", async () => {
    prismaMock.school.findFirst.mockResolvedValue({ isDemo: true });
    const res = await run(startTestLabSession(labForm({ next: "/teacher/aral/profiling" })));
    expect(res).toEqual({ redirectedTo: "/teacher/aral/profiling" });
  });

  it("starts a bound impersonation and audits IMPERSONATION_START with source test-lab, ids only", async () => {
    prismaMock.school.findFirst.mockResolvedValue({ isDemo: true });
    await run(startTestLabSession(labForm()));
    expect(startImpersonationSession).toHaveBeenCalledWith({ targetAuthId: TARGET_AUTH_ID });
    expect(writeAudit).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      userId: ADMIN_ID,
      action: AUDIT_ACTIONS.IMPERSONATION_START,
      resource: "User",
      resourceId: TARGET_ID,
      metadata: { schoolId: SCHOOL_ID, targetRole: "TEACHER", source: "test-lab" },
    });
    expect(JSON.stringify(entry)).not.toContain("t@school.local");
    expect(JSON.stringify(entry)).not.toContain("Some Teacher");
  });
});

describe("endImpersonation", () => {
  /** A fresh session row as `getAuthSession({ fresh: true })` returns it. */
  function impersonatedSession(overrides: Partial<FakeSession["session"]> = {}): FakeSession {
    return {
      user: { id: TARGET_AUTH_ID },
      session: { impersonatedBy: ADMIN_AUTH_ID, ...overrides },
    };
  }

  it("refuses a session that is not an impersonation — the re-login-as-target-then-return scenario", async () => {
    // Story: the admin ends impersonation by signing out (or the browser is
    // simply handed to the target), the target later logs in on the same
    // browser and a stale admin-session cookie is still sitting there. That
    // fresh login is a NEW session row without the server-side
    // `impersonatedBy`, and must not redeem the cookie into a Super Admin session.
    getAuthSession.mockResolvedValue(impersonatedSession({ impersonatedBy: null }));

    const res = await endImpersonation();

    expect(res).toEqual({ ok: false, error: "Not impersonating" });
    expect(getAuthSession).toHaveBeenCalledWith({ fresh: true });
    expect(stopImpersonationSession).not.toHaveBeenCalled();
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("refuses when there is no current session", async () => {
    getAuthSession.mockResolvedValue(null);

    const res = await endImpersonation();

    expect(res).toEqual({ ok: false, error: "Not impersonating" });
    expect(stopImpersonationSession).not.toHaveBeenCalled();
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("refuses but KEEPS the admin cookies when stopping fails, so a blip cannot strand the admin", async () => {
    getAuthSession.mockResolvedValue(impersonatedSession());
    prismaMock.user.findFirst
      .mockResolvedValueOnce({ id: ADMIN_ID })
      .mockResolvedValueOnce({ id: TARGET_ID, school: null });
    stopImpersonationSession.mockRejectedValueOnce(
      new AppError("AUTH_PROVIDER_ERROR", { detail: "stop refused" })
    );

    const res = await endImpersonation();

    expect(res.ok).toBe(false);
    expect(expireImpersonationCookies).not.toHaveBeenCalled();
    expect(endCurrentSession).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("stops the impersonation session on success and audits the end with ids only", async () => {
    getAuthSession.mockResolvedValue(impersonatedSession());
    prismaMock.user.findFirst
      .mockResolvedValueOnce({ id: ADMIN_ID })
      .mockResolvedValueOnce({ id: TARGET_ID, school: { isDemo: false } });

    const res = await run(endImpersonation());

    expect(res).toEqual({ redirectedTo: "/admin/management/teachers" });
    expect(stopImpersonationSession).toHaveBeenCalledTimes(1);
    const end = writeAudit.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((e) => e.action === AUDIT_ACTIONS.IMPERSONATION_END);
    expect(end).toMatchObject({ userId: ADMIN_ID, resource: "User", resourceId: TARGET_ID });
    expect(end?.metadata).toBeUndefined();
    expect(reportError).not.toHaveBeenCalled();
    // The admin is looked up by the server-side `impersonatedBy`, never a client value.
    const adminLookup = prismaMock.user.findFirst.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(adminLookup.where).toMatchObject({
      authId: ADMIN_AUTH_ID,
      role: "SUPER_ADMIN",
      deletedAt: null,
      isActive: true,
    });
  });

  it("reports an unexpected stop failure once, and writes no end-of-impersonation audit row for it", async () => {
    for (const mode of ["throws", "ok"] as const) {
      vi.clearAllMocks();
      getAuthSession.mockResolvedValue(impersonatedSession());
      prismaMock.user.findFirst
        .mockResolvedValueOnce({ id: ADMIN_ID })
        .mockResolvedValueOnce({ id: TARGET_ID, school: null });
      if (mode === "throws") stopImpersonationSession.mockRejectedValueOnce(new Error("network down"));

      await run(endImpersonation());

      const end = writeAudit.mock.calls
        .map((c) => c[0] as Record<string, unknown>)
        .find((e) => e.action === AUDIT_ACTIONS.IMPERSONATION_END);
      if (mode === "throws") {
        expect(reportError).toHaveBeenCalledTimes(1);
        expect(end).toBeUndefined();
      } else {
        expect(reportError).not.toHaveBeenCalled();
        expect(end?.metadata).toBeUndefined();
      }
    }
  });

  it("returns to Test Lab when the return cookie says Test Lab started it (a real district admin)", async () => {
    getAuthSession.mockResolvedValue(impersonatedSession());
    readImpersonation.mockResolvedValue({ returnTo: "test-lab" });
    prismaMock.user.findFirst
      .mockResolvedValueOnce({ id: ADMIN_ID })
      // The district admin: no school, so no demo flag decides the return.
      .mockResolvedValueOnce({ id: TARGET_ID, school: null });

    const res = await run(endImpersonation());

    expect(res).toEqual({ redirectedTo: "/admin/test-lab" });
  });

  it.each([
    [true, "/admin/test-lab"],
    [false, "/admin/management/teachers"],
    [null, "/admin/management/teachers"],
  ])("returns a session whose target school isDemo=%s to %s", async (isDemo, path) => {
    getAuthSession.mockResolvedValue(impersonatedSession());
    prismaMock.user.findFirst
      .mockResolvedValueOnce({ id: ADMIN_ID })
      .mockResolvedValueOnce({ id: TARGET_ID, ...(isDemo === null ? { school: null } : { school: { isDemo } }) });

    const res = await run(endImpersonation());

    expect(res).toEqual({ redirectedTo: path });
    const targetLookup = prismaMock.user.findFirst.mock.calls[1][0] as { where: Record<string, unknown> };
    expect(targetLookup.where).toEqual({ authId: TARGET_AUTH_ID });
  });

  it("still refuses a demoted, inactive, or deleted admin row (re-checked live at return time)", async () => {
    getAuthSession.mockResolvedValue(impersonatedSession());
    // `where` requires role SUPER_ADMIN, isActive true, deletedAt null — a
    // demoted/deactivated/deleted admin simply is not found by it.
    prismaMock.user.findFirst.mockResolvedValueOnce(null);

    const res = await endImpersonation();

    expect(res.ok).toBe(false);
    // The admin does not get their session back, and the impersonated one ends
    // with the cookies that would have restored them.
    expect(stopImpersonationSession).not.toHaveBeenCalled();
    expect(endCurrentSession).toHaveBeenCalledTimes(1);
    expect(expireImpersonationCookies).toHaveBeenCalledTimes(1);
  });
});

describe("logoutAction", () => {
  /** `findUnique` is asked for the signed-in row first, then (impersonation only) the admin row. */
  function rows(own: { id: string; schoolId: string | null } | null, admin: { id: string } | null = null) {
    prismaMock.user.findUnique.mockResolvedValueOnce(own).mockResolvedValueOnce(admin);
  }

  it("clears the impersonation cookies only AFTER the impersonated session has ended", async () => {
    const order: string[] = [];
    expireImpersonationCookies.mockImplementation(async () => {
      order.push("clear");
    });
    endCurrentSession.mockImplementation(async () => {
      order.push("signOut");
      return true;
    });
    getAuthSession.mockResolvedValue({
      user: { id: TARGET_AUTH_ID },
      session: { impersonatedBy: ADMIN_AUTH_ID },
    });
    rows({ id: TARGET_ID, schoolId: SCHOOL_ID }, { id: ADMIN_ID });

    await run(logoutAction());

    expect(order).toEqual(["signOut", "clear"]);
  });

  it.each([false, true])("ends only the impersonated session and audits the admin (target has a school=%s)", async (hasSchool) => {
    const targetSchoolId = hasSchool ? SCHOOL_ID : null;
    getAuthSession.mockResolvedValue({
      user: { id: TARGET_AUTH_ID },
      session: { impersonatedBy: ADMIN_AUTH_ID },
    });
    rows({ id: TARGET_ID, schoolId: targetSchoolId }, { id: ADMIN_ID });

    await run(logoutAction());

    expect(getAuthSession).toHaveBeenCalledWith({ fresh: true });
    expect(endCurrentSession).toHaveBeenCalledTimes(1);
    // The target's own phone and laptop sessions must survive an admin's sign-out.
    expect(revokeAllSessions).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      userId: ADMIN_ID,
      schoolId: targetSchoolId,
      action: AUDIT_ACTIONS.IMPERSONATION_END,
      resourceId: TARGET_ID,
    }));
  });

  it("revokes every session of an ordinary sign-out (the old 'global' scope)", async () => {
    getAuthSession.mockResolvedValue({
      user: { id: TARGET_AUTH_ID },
      session: { impersonatedBy: null },
    });
    rows({ id: TARGET_ID, schoolId: SCHOOL_ID });

    await run(logoutAction());

    expect(endCurrentSession).toHaveBeenCalledTimes(1);
    expect(revokeAllSessions).toHaveBeenCalledWith(TARGET_AUTH_ID);
    expect(expireImpersonationCookies).not.toHaveBeenCalled();
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: AUDIT_ACTIONS.LOGOUT }));
  });

  it("treats a stale admin-session cookie as nothing when the session is not an impersonation", async () => {
    // The target signed in again on the browser that still holds an admin
    // cookie: a new row without `impersonatedBy`, so it is an ordinary sign-out
    // and must never be audited as an admin's impersonation ending.
    getAuthSession.mockResolvedValue({
      user: { id: TARGET_AUTH_ID },
      session: { impersonatedBy: null },
    });
    rows({ id: TARGET_ID, schoolId: SCHOOL_ID });

    await run(logoutAction());

    expect(revokeAllSessions).toHaveBeenCalledWith(TARGET_AUTH_ID);
    expect(expireImpersonationCookies).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalledWith(expect.objectContaining({ action: AUDIT_ACTIONS.IMPERSONATION_END }));
  });

  it.each(["returned", "thrown"])("retains the admin cookies and writes no completion audit on %s provider failure", async (failure) => {
    getAuthSession.mockResolvedValue({
      user: { id: TARGET_AUTH_ID },
      session: { impersonatedBy: ADMIN_AUTH_ID },
    });
    rows({ id: TARGET_ID, schoolId: SCHOOL_ID }, { id: ADMIN_ID });
    if (failure === "returned") endCurrentSession.mockResolvedValueOnce(false);
    else endCurrentSession.mockRejectedValueOnce(new Error("unavailable"));

    await expect(logoutAction()).rejects.toThrow();

    expect(expireImpersonationCookies).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("resetTeacherPassword", () => {
  it("refuses a non-Super-Admin caller", async () => {
    requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login"));
    await expect(resetTeacherPassword(form())).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a non-TEACHER target", async () => {
    // `role: "TEACHER"` is baked into the `where`, so a School Head / Super
    // Admin id is simply not found.
    prismaMock.user.findFirst.mockResolvedValueOnce(null);
    const res = await resetTeacherPassword(form());
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });

  it("writes exactly the four documented update fields, with no isActive key at all", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: TARGET_ID,
      authId: "auth-teacher-1",
      schoolId: SCHOOL_ID,
    });

    const res = await resetTeacherPassword(form());
    expect(res.ok).toBe(true);

    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.user.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: TARGET_ID });
    expect(call.data).toEqual({
      mustChangePassword: true,
      passwordIsSchoolId: false,
      passwordVaultCipher: null,
      passwordVaultSetAt: null,
    });
    expect(Object.prototype.hasOwnProperty.call(call.data, "isActive")).toBe(false);
    expect(prismaWithTx.$transaction).toHaveBeenCalledTimes(1);

    // The identity gets a bcrypt hash of the returned password, written in the
    // same transaction client as the flags, and its role stays TEACHER.
    const password = res.ok ? res.data.password : "";
    expect(setPassword).toHaveBeenCalledTimes(1);
    expect(setPassword.mock.calls[0][0]).toBe("auth-teacher-1");
    const { hash } = setPassword.mock.calls[0][1] as { hash: string };
    expect(isBcryptHash(hash)).toBe(true);
    expect(await verifyPassword({ hash, password })).toBe(true);
    expect(setPassword.mock.calls[0][2]).toBe(prismaMock);
    expect(setRole).toHaveBeenCalledWith("auth-teacher-1", "TEACHER", prismaMock);
  });

  it("never puts the returned credential in audit metadata", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: TARGET_ID,
      authId: "auth-teacher-1",
      schoolId: SCHOOL_ID,
    });

    const res = await resetTeacherPassword(form());
    expect(res.ok).toBe(true);
    const password = res.ok ? res.data.password : "";
    expect(password.length).toBeGreaterThan(0);

    expect(writeAudit).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      action: AUDIT_ACTIONS.TEACHER_PASSWORD_RESET,
      resource: "User",
      resourceId: TARGET_ID,
      metadata: { schoolId: SCHOOL_ID, via: "admin_accounts" },
    });
    expect(JSON.stringify(entry)).not.toContain(password);
  });
});

describe("session revocation after an admin password reset", () => {
  it("resetTeacherPassword revokes every session of the target, after the transaction commits", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: TARGET_ID,
      authId: "auth-teacher-1",
      schoolId: SCHOOL_ID,
    });

    const res = await resetTeacherPassword(form());

    expect(res.ok).toBe(true);
    expect(revokeAllSessions).toHaveBeenCalledTimes(1);
    expect(revokeAllSessions).toHaveBeenCalledWith("auth-teacher-1");
    const revokeAt = revokeAllSessions.mock.invocationCallOrder[0];
    expect(revokeAt).toBeGreaterThan(setPassword.mock.invocationCallOrder[0]);
    expect(revokeAt).toBeGreaterThan(prismaMock.user.update.mock.invocationCallOrder[0]);
    // Before the audit row: a revoke failure must not be hidden behind it.
    expect(revokeAt).toBeLessThan(writeAudit.mock.invocationCallOrder[0]);
  });

  it("resetTeacherPassword does not revoke when the password write fails", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: TARGET_ID,
      authId: "auth-teacher-1",
      schoolId: SCHOOL_ID,
    });
    setPassword.mockRejectedValueOnce(new Error("db down"));

    const res = await resetTeacherPassword(form());

    expect(res.ok).toBe(false);
    expect(revokeAllSessions).not.toHaveBeenCalled();
  });

  it("resetDistrictAdminPassword revokes every session of the target, after the transaction commits", async () => {
    const targetId = "66666666-6666-4666-8666-666666666666";
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: targetId,
      authId: "auth-district-1",
      schoolId: null,
      firstName: "Juan",
      lastName: "Dela Cruz",
    });

    const res = await resetDistrictAdminPassword(form(targetId));

    expect(res.ok).toBe(true);
    expect(revokeAllSessions).toHaveBeenCalledTimes(1);
    expect(revokeAllSessions).toHaveBeenCalledWith("auth-district-1");
    expect(revokeAllSessions.mock.invocationCallOrder[0]).toBeGreaterThan(
      setPassword.mock.invocationCallOrder[0]
    );
  });

  it("resetDistrictAdminPassword does not revoke when the password write fails", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: "66666666-6666-4666-8666-666666666666",
      authId: "auth-district-1",
      schoolId: null,
      firstName: "Juan",
      lastName: "Dela Cruz",
    });
    setPassword.mockRejectedValueOnce(new Error("db down"));

    const res = await resetDistrictAdminPassword(form("66666666-6666-4666-8666-666666666666"));

    expect(res.ok).toBe(false);
    expect(revokeAllSessions).not.toHaveBeenCalled();
  });
});

describe("resetDistrictAdminPassword", () => {
  it("refuses a non-Super-Admin caller — a district admin cannot reset its own or another's password this way", async () => {
    // T13: "resetDistrictAdminPassword as a DA is forbidden." `requireUser`
    // itself redirects a signed-in DISTRICT_ADMIN caller (the real gate lives
    // in `src/lib/auth/session.ts`); this fake reproduces that refusal the
    // same way every other "non-Super-Admin caller" case in this file does.
    requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/admin/login"));
    await expect(resetDistrictAdminPassword(form())).rejects.toThrow(
      "NEXT_REDIRECT:/admin/login"
    );
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("refuses a non-DISTRICT_ADMIN target", async () => {
    // `role: "DISTRICT_ADMIN"` is baked into the `where`, and the default
    // fake honors it (`matchesRoleWhere`): a TEACHER row does not match, so
    // this reads exactly as Prisma would with that filter in place. Deleting
    // the filter from the action would make this fake return the teacher row
    // instead of null, and the action would go on to reset a teacher's
    // password under the district admin's own audit action — turning this
    // test red.
    targetRow = teacher({ role: "TEACHER" });
    const res = await resetDistrictAdminPassword(form());
    expect(res).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("sets mustChangePassword true, identity role DISTRICT_ADMIN, and never leaks the credential in metadata", async () => {
    const targetId = "66666666-6666-4666-8666-666666666666";
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: targetId,
      authId: "auth-district-1",
      schoolId: null,
      firstName: "Juan",
      lastName: "Dela Cruz",
    });

    const res = await resetDistrictAdminPassword(form(targetId));
    expect(res.ok).toBe(true);
    const password = res.ok ? res.data.password : "";
    expect(password).toBe("Juan.DelaCruz1234");

    expect(setPassword).toHaveBeenCalledTimes(1);
    expect(setPassword.mock.calls[0][0]).toBe("auth-district-1");
    const { hash } = setPassword.mock.calls[0][1] as { hash: string };
    expect(isBcryptHash(hash)).toBe(true);
    expect(await verifyPassword({ hash, password })).toBe(true);
    // Never widened: a reset must not gain the account any privilege.
    expect(setRole).toHaveBeenCalledWith("auth-district-1", "DISTRICT_ADMIN", prismaMock);
    expect(setRole).not.toHaveBeenCalledWith(expect.anything(), "SUPER_ADMIN", expect.anything());

    expect(prismaMock.user.update).toHaveBeenCalledTimes(1);
    const call = prismaMock.user.update.mock.calls[0][0] as { where: unknown; data: Record<string, unknown> };
    expect(call.where).toEqual({ id: targetId });
    expect(call.data).toMatchObject({ mustChangePassword: true });

    expect(writeAudit).toHaveBeenCalledTimes(1);
    const entry = writeAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      userId: ADMIN_ID,
      schoolId: null,
      action: AUDIT_ACTIONS.DISTRICT_ADMIN_PASSWORD_RESET,
      resource: "User",
      resourceId: targetId,
    });
    expect(JSON.stringify(entry)).not.toContain(password);
    expect(JSON.stringify(entry)).not.toContain("1234");
  });

  it("forces the password change in the same transaction as the password swap", async () => {
    // A guessable First.Last1234 password must never be live without the
    // forced change: flag and password commit together, with the flag written
    // first, so a failed write rolls both back instead of leaving the new
    // password unprotected.
    const targetId = "77777777-7777-4777-8777-777777777777";
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: targetId,
      authId: "auth-district-2",
      schoolId: null,
      firstName: "Ana",
      lastName: "Reyes",
    });

    const res = await resetDistrictAdminPassword(form(targetId));
    expect(res.ok).toBe(true);
    const flagAt = prismaMock.user.update.mock.invocationCallOrder[0];
    const swapAt = setPassword.mock.invocationCallOrder[0];
    expect(prismaWithTx.$transaction).toHaveBeenCalledTimes(1);
    expect(flagAt).toBeDefined();
    expect(swapAt).toBeDefined();
    expect(flagAt!).toBeLessThan(swapAt!);
  });
});

describe("getAccountProfile", () => {
  it("refuses a non-Super-Admin caller", async () => {
    requireUser.mockRejectedValueOnce(new Error("NEXT_REDIRECT:/login"));
    await expect(getAccountProfile(TARGET_ID)).rejects.toThrow("NEXT_REDIRECT:/login");
    expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
  });

  it("returns null advisory/aral for a non-teacher, within a bounded query count", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: TARGET_ID,
      role: "SCHOOL_HEAD",
      fullName: "Head Person",
      firstName: "Head",
      lastName: "Person",
      email: "head@school.local",
      username: null,
      schoolId: SCHOOL_ID,
      isActive: true,
      mustChangePassword: false,
      profileCompleted: true,
      approvalStatus: null,
      approvedAt: null,
      rejectedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastSeenReleaseVersion: null,
      school: { id: SCHOOL_ID, name: "Sample ES", schoolIdCode: "111111" },
      teacherProfile: null,
      advisorySections: [],
    });

    const res = await getAccountProfile(TARGET_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");
    expect(res.data.advisory).toBeNull();
    expect(res.data.aral).toBeNull();

    // 1 findFirst (user) + learner.groupBy skipped (no sections) + learner.count
    // skipped (not a teacher) + auditLog.findFirst (last denied) + one
    // $queryRaw (submission maxima) + auditLog.findMany (security activity).
    expect(prismaMock.user.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.learner.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.learner.count).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.groupBy).not.toHaveBeenCalled();
    expect(prismaMock.auditLog.findFirst).toHaveBeenCalledTimes(1);
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prismaMock.auditLog.findMany).toHaveBeenCalledTimes(1);
  });

  it("reads last sign-in from User.lastLoginAt and submissions from the domain tables", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: TARGET_ID,
      role: "TEACHER",
      fullName: "Teacher Person",
      firstName: "Teacher",
      lastName: "Person",
      email: "teacher@school.local",
      username: null,
      schoolId: SCHOOL_ID,
      isActive: true,
      mustChangePassword: false,
      profileCompleted: true,
      approvalStatus: "APPROVED",
      approvedAt: null,
      rejectedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastSeenReleaseVersion: null,
      lastLoginAt: new Date("2026-09-26T08:30:00.000Z"),
      school: { id: SCHOOL_ID, name: "Sample ES", schoolIdCode: "111111" },
      teacherProfile: null,
      advisorySections: [],
    });
    prismaMock.auditLog.findFirst.mockResolvedValueOnce({
      timestamp: new Date("2026-09-25T00:00:00.000Z"),
    });
    prismaMock.$queryRaw.mockResolvedValueOnce([
      {
        attendanceAt: new Date("2026-09-24T01:00:00.000Z"),
        readingLevelAt: null,
        termGradesAt: new Date("2026-09-20T02:00:00.000Z"),
      },
    ]);

    const res = await getAccountProfile(TARGET_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("expected ok");

    expect(res.data.lastSignInAt).toBe("2026-09-26T08:30:00.000Z");
    expect(res.data.lastSignInDeniedAt).toBe("2026-09-25T00:00:00.000Z");
    expect(res.data.submissions).toEqual({
      lastAttendanceWeekSaveAt: "2026-09-24T01:00:00.000Z",
      lastReadingLevelRecordAt: null,
      lastTermGradesSaveAt: "2026-09-20T02:00:00.000Z",
    });

    // The profile select must ask for the column it reads.
    const userArgs = prismaMock.user.findFirst.mock.calls[0][0] as {
      select: Record<string, unknown>;
    };
    expect(userArgs.select.lastLoginAt).toBe(true);

    // The submission query is keyed on this account's recorder id.
    const rawValues = prismaMock.$queryRaw.mock.calls[0].slice(1);
    expect(rawValues).toEqual([TARGET_ID, TARGET_ID, TARGET_ID]);

    // Recent activity is restricted to security actions, so leftover routine
    // rows never appear under the security heading.
    const findManyArgs = prismaMock.auditLog.findMany.mock.calls[0][0] as {
      where: { userId: string; action: { in: string[] } };
    };
    expect(findManyArgs.where.userId).toBe(TARGET_ID);
    expect(findManyArgs.where.action.in).toContain("LOGIN_DENIED");
    expect(findManyArgs.where.action.in).not.toContain("LOGIN_SUCCESS");
    expect(findManyArgs.where.action.in).not.toContain("ATTENDANCE_WEEK_SAVE");
  });

  it("reports no recorded sign-in when lastLoginAt is null", async () => {
    prismaMock.user.findFirst.mockResolvedValueOnce({
      id: TARGET_ID,
      role: "SCHOOL_HEAD",
      fullName: "Head Person",
      firstName: "Head",
      lastName: "Person",
      email: "head@school.local",
      username: null,
      schoolId: SCHOOL_ID,
      isActive: true,
      mustChangePassword: false,
      profileCompleted: true,
      approvalStatus: null,
      approvedAt: null,
      rejectedAt: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      lastSeenReleaseVersion: null,
      lastLoginAt: null,
      school: { id: SCHOOL_ID, name: "Sample ES", schoolIdCode: "111111" },
      teacherProfile: null,
      advisorySections: [],
    });

    const res = await getAccountProfile(TARGET_ID);
    if (!res.ok) throw new Error("expected ok");
    expect(res.data.lastSignInAt).toBeNull();
    expect(res.data.lastSignInDeniedAt).toBeNull();
  });
});
