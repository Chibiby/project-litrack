import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Role matrix for the highest-risk server actions (audit A42).
 *
 * Guards were previously pinned by source-text checks or per-action mocks. Here
 * the REAL guards run — `requireUser`, `requireSchoolUser`,
 * `requireDeveloperAdmin` (all `@/lib/auth/session`) and `requireAdminScope`
 * (`@/lib/auth/district-scope`) — and only their boundaries are faked: the
 * Better Auth session lookup, the Prisma user row, and `next/navigation`
 * (`redirect` throws exactly as the real one does, so the `action()` wrapper's
 * `unstable_rethrow` path is exercised).
 *
 * For every (action, caller) pair we assert ONLY the guard outcome:
 *
 *   - `redirect:<path>`  the guard redirected (signed out, wrong role, no school)
 *   - `forbidden`        the wrapper returned `{ ok: false, code: "AUTH_FORBIDDEN" }`
 *   - `allowed`          the guard let the caller through (the body then fails
 *                        on the empty input / unmocked Prisma, which is not
 *                        what is under test and is never asserted)
 *
 * Rules the expectations encode (CLAUDE.md "Auth and session"):
 *   - `requireUser(roles)` lets SUPER_ADMIN through every list by default;
 *     `requireSchoolUser` then redirects a caller with no school (a Super Admin
 *     has `schoolId: null`) to their role home.
 *   - `requireAdminScope` names SUPER_ADMIN and DISTRICT_ADMIN explicitly and
 *     turns the implicit Super Admin pass off.
 *   - `requireDeveloperAdmin` throws AUTH_FORBIDDEN for a Division Admin.
 *   - Signed-out callers go to /admin/login when the guard names an admin role,
 *     /login otherwise.
 */

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  claimsSub: undefined as string | undefined,
  userRow: null as Record<string, unknown> | null,
  districts: ["District 1"] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  unstable_rethrow: (err: unknown) => {
    if (
      err instanceof Error &&
      (err.message.startsWith("NEXT_REDIRECT:") || err.message === "NEXT_NOT_FOUND")
    ) {
      throw err;
    }
  },
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T,>(fn: T) => fn,
}));

// The Better Auth session boundary: `getAuthSession` is what `requireUser`
// resolves a caller from. `claimsSub` is the signed-in identity's authId.
vi.mock("@/lib/auth/auth-session", () => ({
  getAuthSession: async () =>
    state.claimsSub
      ? { user: { id: state.claimsSub }, session: { impersonatedBy: null } }
      : null,
  endCurrentSession: async () => true,
  revokeAllSessions: async () => 0,
  signInWithPassword: async () => ({ ok: false }),
}));
vi.mock("@/lib/db/read-mode", () => ({ primeReadMode: async () => {} }));

vi.mock("@/lib/auth/impersonation-session", () => ({
  expireImpersonationCookies: async () => {},
  isVerifiedImpersonationOf: async () => false,
  readImpersonation: async () => null,
  startImpersonationSession: async () => {},
  stopImpersonationSession: async () => {},
}));

// Reporting a body failure must not reach the real ErrorEvent writer.
vi.mock("@/lib/errors/report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/errors/report")>()),
  reportError: () => "ref",
}));

// Any Prisma call resolves to undefined (the body is allowed to fail), except
// the two lookups the guards themselves make.
vi.mock("@/lib/prisma", () => {
  const deep = (path: string[]): unknown =>
    new Proxy(function () {}, {
      get: (_t, prop) => {
        if (prop === "then") return undefined;
        return deep([...path, String(prop)]);
      },
      apply: async () => {
        const key = path.join(".");
        if (key === "user.findUnique") return state.userRow;
        if (key === "districtAdminAssignment.findMany") {
          return state.districts.map((district) => ({ district }));
        }
        return undefined;
      },
    });
  return { prisma: deep([]), prismaFresh: deep([]) };
});

import { createLearner, archiveLearner, deleteLearners, setLearnerAralTeacher } from "@/lib/actions/learner";
import { transferLearner, transferLearnerCrossSchool } from "@/lib/actions/enrollment";
import {
  transferLearnersToSection,
  requestSectionTransfers,
  approveSectionTransferRequests,
  declineSectionTransferRequests,
  cancelSectionTransferRequest,
} from "@/lib/actions/section-transfer";
import { markAttendance, saveAralWeeklyAttendance } from "@/lib/actions/attendance";
import { saveAralProfile } from "@/lib/actions/aral";
import { commitLearnerImport } from "@/lib/actions/import-learners";
import { createSection, deleteSection } from "@/lib/actions/section";
import { setActiveSchoolYear } from "@/lib/actions/school-year";
import {
  revealSchoolHeadPassword,
  impersonateUser,
  resetTeacherPassword,
  startTestLabSession,
} from "@/lib/actions/accounts";
import {
  updateSchoolInfo,
  updateSchoolAsAdmin,
  setSchoolActive,
} from "@/lib/actions/school-management";
import { restoreRemovedLearner, purgeRemovedTeacher } from "@/lib/actions/admin-archive";
import { resetOperationalData } from "@/lib/actions/database";
import { issueUnlock, revokeUnlock } from "@/lib/actions/unlock-admin";

type Caller =
  | "TEACHER"
  | "SCHOOL_HEAD"
  | "SUPER_ADMIN_DEVELOPER"
  | "SUPER_ADMIN_DIVISION"
  | "DISTRICT_ADMIN"
  | "ANONYMOUS";

const CALLERS: Caller[] = [
  "TEACHER",
  "SCHOOL_HEAD",
  "SUPER_ADMIN_DEVELOPER",
  "SUPER_ADMIN_DIVISION",
  "DISTRICT_ADMIN",
  "ANONYMOUS",
];

function userFor(caller: Exclude<Caller, "ANONYMOUS">, overrides: Row = {}): Row {
  const base: Row = {
    id: `user-${caller}`,
    authId: "auth-1",
    email: "x@example.test",
    name: "Test",
    role: "TEACHER",
    adminTier: null,
    schoolId: "school-1",
    isActive: true,
    deletedAt: null,
    approvalStatus: "APPROVED",
    mustChangePassword: false,
    profileCompleted: true,
  };
  switch (caller) {
    case "TEACHER":
      break;
    case "SCHOOL_HEAD":
      base.role = "SCHOOL_HEAD";
      break;
    case "SUPER_ADMIN_DEVELOPER":
      Object.assign(base, { role: "SUPER_ADMIN", adminTier: "DEVELOPER", schoolId: null });
      break;
    case "SUPER_ADMIN_DIVISION":
      Object.assign(base, { role: "SUPER_ADMIN", adminTier: "DIVISION", schoolId: null });
      break;
    case "DISTRICT_ADMIN":
      Object.assign(base, { role: "DISTRICT_ADMIN", schoolId: null });
      break;
  }
  return { ...base, ...overrides };
}

function signIn(caller: Caller, overrides: Row = {}): void {
  if (caller === "ANONYMOUS") {
    state.claimsSub = undefined;
    state.userRow = null;
    return;
  }
  state.claimsSub = "auth-1";
  state.userRow = userFor(caller, overrides);
}

type Outcome = string;

async function observe(fn: (...args: unknown[]) => Promise<unknown>): Promise<Outcome> {
  try {
    const result = (await fn(new FormData())) as { ok?: boolean; code?: string } | undefined;
    if (result && result.ok === false && result.code === "AUTH_FORBIDDEN") return "forbidden";
    return "allowed";
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("NEXT_REDIRECT:")) {
      return `redirect:${err.message.slice("NEXT_REDIRECT:".length)}`;
    }
    throw err;
  }
}

/** Where each wrong caller lands: their role home. */
const HOME: Record<Exclude<Caller, "ANONYMOUS">, string> = {
  TEACHER: "/teacher",
  SCHOOL_HEAD: "/school-head",
  SUPER_ADMIN_DEVELOPER: "/admin",
  SUPER_ADMIN_DIVISION: "/admin",
  DISTRICT_ADMIN: "/district",
};

const allowed = "allowed";
const redirectHome = (c: Exclude<Caller, "ANONYMOUS">) => `redirect:${HOME[c]}`;

type GuardKind = "teacher" | "schoolHead" | "superAdmin" | "developerAdmin" | "adminScope";

/** Expected outcome for every caller, per the guard the action actually calls. */
const EXPECTED: Record<GuardKind, Record<Caller, Outcome>> = {
  // requireSchoolUser("TEACHER"): SUPER_ADMIN passes the role list but has no
  // schoolId, so requireSchoolUser sends it home.
  teacher: {
    TEACHER: allowed,
    SCHOOL_HEAD: redirectHome("SCHOOL_HEAD"),
    SUPER_ADMIN_DEVELOPER: redirectHome("SUPER_ADMIN_DEVELOPER"),
    SUPER_ADMIN_DIVISION: redirectHome("SUPER_ADMIN_DIVISION"),
    DISTRICT_ADMIN: redirectHome("DISTRICT_ADMIN"),
    ANONYMOUS: "redirect:/login",
  },
  schoolHead: {
    TEACHER: redirectHome("TEACHER"),
    SCHOOL_HEAD: allowed,
    SUPER_ADMIN_DEVELOPER: redirectHome("SUPER_ADMIN_DEVELOPER"),
    SUPER_ADMIN_DIVISION: redirectHome("SUPER_ADMIN_DIVISION"),
    DISTRICT_ADMIN: redirectHome("DISTRICT_ADMIN"),
    ANONYMOUS: "redirect:/login",
  },
  // requireUser("SUPER_ADMIN"): either Super Admin tier; a district admin is
  // not a Super Admin.
  superAdmin: {
    TEACHER: redirectHome("TEACHER"),
    SCHOOL_HEAD: redirectHome("SCHOOL_HEAD"),
    SUPER_ADMIN_DEVELOPER: allowed,
    SUPER_ADMIN_DIVISION: allowed,
    DISTRICT_ADMIN: redirectHome("DISTRICT_ADMIN"),
    ANONYMOUS: "redirect:/admin/login",
  },
  // requireDeveloperAdmin: requireUser("SUPER_ADMIN") then the tier check.
  developerAdmin: {
    TEACHER: redirectHome("TEACHER"),
    SCHOOL_HEAD: redirectHome("SCHOOL_HEAD"),
    SUPER_ADMIN_DEVELOPER: allowed,
    SUPER_ADMIN_DIVISION: "forbidden",
    DISTRICT_ADMIN: redirectHome("DISTRICT_ADMIN"),
    ANONYMOUS: "redirect:/admin/login",
  },
  // requireAdminScope: Super Admin (division) or District Admin with assignments.
  adminScope: {
    TEACHER: redirectHome("TEACHER"),
    SCHOOL_HEAD: redirectHome("SCHOOL_HEAD"),
    SUPER_ADMIN_DEVELOPER: allowed,
    SUPER_ADMIN_DIVISION: allowed,
    DISTRICT_ADMIN: allowed,
    ANONYMOUS: "redirect:/admin/login",
  },
};

type ActionFn = (...args: never[]) => Promise<unknown>;

const ACTIONS: Array<{ name: string; fn: ActionFn; guard: GuardKind }> = [
  // Learner / enrollment / attendance / ARAL / import
  { name: "createLearner", fn: createLearner as ActionFn, guard: "teacher" },
  { name: "archiveLearner", fn: archiveLearner as ActionFn, guard: "teacher" },
  { name: "deleteLearners", fn: deleteLearners as ActionFn, guard: "teacher" },
  { name: "markAttendance", fn: markAttendance as ActionFn, guard: "teacher" },
  { name: "saveAralWeeklyAttendance", fn: saveAralWeeklyAttendance as ActionFn, guard: "teacher" },
  { name: "saveAralProfile", fn: saveAralProfile as ActionFn, guard: "teacher" },
  { name: "commitLearnerImport", fn: commitLearnerImport as ActionFn, guard: "teacher" },
  { name: "setLearnerAralTeacher", fn: setLearnerAralTeacher as ActionFn, guard: "schoolHead" },
  { name: "transferLearner", fn: transferLearner as ActionFn, guard: "schoolHead" },
  // Section transfers: the School Head moves and decides, the teacher asks and withdraws.
  { name: "transferLearnersToSection", fn: transferLearnersToSection as ActionFn, guard: "schoolHead" },
  { name: "approveSectionTransferRequests", fn: approveSectionTransferRequests as ActionFn, guard: "schoolHead" },
  { name: "declineSectionTransferRequests", fn: declineSectionTransferRequests as ActionFn, guard: "schoolHead" },
  { name: "requestSectionTransfers", fn: requestSectionTransfers as ActionFn, guard: "teacher" },
  { name: "cancelSectionTransferRequest", fn: cancelSectionTransferRequest as ActionFn, guard: "teacher" },
  // School head: sections, school year, school info
  { name: "createSection", fn: createSection as ActionFn, guard: "schoolHead" },
  { name: "deleteSection", fn: deleteSection as ActionFn, guard: "schoolHead" },
  { name: "setActiveSchoolYear", fn: setActiveSchoolYear as ActionFn, guard: "schoolHead" },
  { name: "updateSchoolInfo", fn: updateSchoolInfo as ActionFn, guard: "schoolHead" },
  // Accounts (Super Admin, either tier)
  { name: "revealSchoolHeadPassword", fn: revealSchoolHeadPassword as ActionFn, guard: "superAdmin" },
  { name: "impersonateUser", fn: impersonateUser as ActionFn, guard: "superAdmin" },
  { name: "resetTeacherPassword", fn: resetTeacherPassword as ActionFn, guard: "superAdmin" },
  // Developer Controls (Developer tier only)
  { name: "startTestLabSession", fn: startTestLabSession as ActionFn, guard: "developerAdmin" },
  { name: "restoreRemovedLearner", fn: restoreRemovedLearner as ActionFn, guard: "developerAdmin" },
  { name: "purgeRemovedTeacher", fn: purgeRemovedTeacher as ActionFn, guard: "developerAdmin" },
  { name: "resetOperationalData", fn: resetOperationalData as ActionFn, guard: "developerAdmin" },
  // Admin scope (division or district)
  { name: "updateSchoolAsAdmin", fn: updateSchoolAsAdmin as ActionFn, guard: "adminScope" },
  { name: "setSchoolActive", fn: setSchoolActive as ActionFn, guard: "adminScope" },
  { name: "transferLearnerCrossSchool", fn: transferLearnerCrossSchool as ActionFn, guard: "adminScope" },
  { name: "issueUnlock", fn: issueUnlock as ActionFn, guard: "adminScope" },
  { name: "revokeUnlock", fn: revokeUnlock as ActionFn, guard: "adminScope" },
];

const run = (a: { fn: ActionFn }) => observe(a.fn as unknown as (...args: unknown[]) => Promise<unknown>);

beforeEach(() => {
  state.claimsSub = undefined;
  state.userRow = null;
  state.districts = ["District 1"];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("role matrix: every action rejects the wrong caller", () => {
  const cases = ACTIONS.flatMap((a) => CALLERS.map((caller) => ({ a, caller })));

  it.each(cases.map((c) => [c.a.name, c.caller, c.a.guard, c] as const))(
    "%s as %s (%s guard)",
    async (_name, caller, guard, c) => {
      signIn(caller);
      expect(await run(c.a)).toBe(EXPECTED[guard][caller]);
    }
  );

  it("covers the guard families the audit named", () => {
    expect(new Set(ACTIONS.map((a) => a.guard))).toEqual(
      new Set(["teacher", "schoolHead", "superAdmin", "developerAdmin", "adminScope"])
    );
    expect(ACTIONS.length).toBeGreaterThanOrEqual(15);
  });
});

describe("role matrix: a District Admin with no assignments", () => {
  // Deliberate design, not a hole: the guard admits the admin and the scope
  // (`districts: []` -> `in: []`) then matches no school, so every target
  // lookup misses. Pinned so a change to that rule is a conscious one.
  it.each(ACTIONS.filter((a) => a.guard === "adminScope").map((a) => [a.name, a] as const))(
    "%s passes the guard with an empty scope",
    async (_name, a) => {
      state.districts = [];
      signIn("DISTRICT_ADMIN");
      expect(await run(a)).toBe("allowed");
    }
  );
});

describe("role matrix: the right role is still refused when the account is not usable", () => {
  // The caller that WOULD be allowed for each guard.
  const RIGHT_ROLE: Record<GuardKind, Exclude<Caller, "ANONYMOUS">> = {
    teacher: "TEACHER",
    schoolHead: "SCHOOL_HEAD",
    superAdmin: "SUPER_ADMIN_DIVISION",
    developerAdmin: "SUPER_ADMIN_DEVELOPER",
    adminScope: "SUPER_ADMIN_DIVISION",
  };
  const loginBase = (g: GuardKind) =>
    g === "teacher" || g === "schoolHead" ? "/login" : "/admin/login";

  const rows = ACTIONS.map((a) => [a.name, a] as const);

  it.each(rows)("%s refuses a soft-deleted account", async (_n, a) => {
    signIn(RIGHT_ROLE[a.guard], { deletedAt: new Date() });
    const out = await run(a);
    expect(out.startsWith(`redirect:${loginBase(a.guard)}`)).toBe(true);
  });

  it.each(rows)("%s refuses a deactivated account", async (_n, a) => {
    signIn(RIGHT_ROLE[a.guard], { isActive: false });
    const out = await run(a);
    expect(out.startsWith(`redirect:${loginBase(a.guard)}`)).toBe(true);
  });

  it.each(rows)("%s sends an account with a forced password change to set-password", async (_n, a) => {
    signIn(RIGHT_ROLE[a.guard], { mustChangePassword: true });
    expect(await run(a)).toBe("redirect:/account/set-password");
  });

  it.each(ACTIONS.filter((a) => a.guard === "teacher").map((a) => [a.name, a] as const))(
    "%s refuses a pending teacher",
    async (_n, a) => {
      signIn("TEACHER", { approvalStatus: "PENDING" });
      expect(await run(a)).toBe("redirect:/pending-approval");
    }
  );

  it.each(ACTIONS.filter((a) => a.guard === "teacher").map((a) => [a.name, a] as const))(
    "%s refuses a rejected teacher",
    async (_n, a) => {
      signIn("TEACHER", { approvalStatus: "REJECTED" });
      const out = await run(a);
      expect(out.startsWith("redirect:/login")).toBe(true);
    }
  );
});
