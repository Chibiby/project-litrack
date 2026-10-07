"use server";

import { redirect } from "next/navigation";
import type {
  AdvisoryMode,
  EmploymentType,
  TeacherApprovalStatus,
  UserRole,
} from "@prisma/client";
import { prisma, prismaFresh } from "@/lib/prisma";
import { requireDeveloperAdmin, requireUser } from "@/lib/auth/session";
import { roleHomePath } from "@/lib/auth/roles";
import { hashPassword } from "@/lib/auth/password-hash";
import { setPassword, setRole } from "@/lib/auth/identity";
import { revokeAllSessions } from "@/lib/auth/auth-session";
import { endCurrentSession, getAuthSession } from "@/lib/auth/auth-session";
import {
  expireImpersonationCookies,
  readImpersonation,
  startImpersonationSession,
  stopImpersonationSession,
  type ImpersonationReturnTo,
} from "@/lib/auth/impersonation-session";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { SECURITY_AUDIT_ACTIONS } from "@/lib/audit-actions";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidateSchoolsList, revalidateAdminAccountPages } from "@/lib/cache/revalidate";
import { defaultSchoolHeadPassword } from "@/lib/auth/school-head-password";
import { findSignInSchoolHead } from "@/lib/auth/school-head-sign-in";
import { openPasswordWithSource, sealPassword } from "@/lib/auth/password-vault";
import { generateActivationCredential, districtAdminPassword } from "@/lib/auth/credentials";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { isAralVolunteerDesignation } from "@/lib/teachers/scope";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { action } from "@/lib/errors/action";
import { AppError, isAppError, resourceNotFound, tooManyAttempts } from "@/lib/errors/app-error";
import { parseInput } from "@/lib/errors/validation";
import { accountUserIdSchema, impersonateUserSchema } from "@/lib/validators/accounts.schema";
import { startTestLabSessionSchema } from "@/lib/validators/test-lab.schema";
import {
  resolveTestLabNext,
  testLabPersonaEmail,
  testLabPersonaRole,
} from "@/lib/test-lab/personas";
import { assertTestableSchool, impersonationReturnPath } from "@/lib/auth/test-lab";
import type { AccountSignIn } from "@/lib/admin/accounts";

/**
 * Super Admin accounts console (`/admin/accounts`).
 *
 * Every control an admin has over somebody else's account lives here and
 * nowhere else — that single-module rule is what stops reveal / reset /
 * impersonate drifting into two implementations. All of them are keyed on
 * `User.id`, because the console lists people across every tenant and a school
 * id cannot name a teacher.
 *
 * Four ways in, in increasing order of how much they disturb the person on the
 * other end:
 *  - `getAccountProfile` reads state only. Nothing changes; no audit row.
 *  - `revealSchoolHeadPassword` shows the password a School Head is using right
 *    now, when LITRACK holds a sealed copy. Nothing changes for the head.
 *  - `impersonateUser` takes over the session without touching the password at
 *    all, so their own login keeps working.
 *  - `resetSchoolHeadPasswordToDefault` / `resetTeacherPassword` replace the
 *    password, which invalidates whatever they had.
 *
 * Authorization, stated once because every function below depends on it: this
 * console is deliberately cross-tenant and `requireUser("SUPER_ADMIN")` is the
 * ONLY gate. There is no `schoolId` scoping to apply — a Super Admin's own
 * `schoolId` is null and the whole purpose is to reach any school. The
 * tenant-scoping rule is replaced here by three narrower ones, enforced in
 * every single target lookup: `deletedAt: null` (a removed account is
 * `/admin/archive`'s, and must never be reset or impersonated), an explicit
 * role refusal where the operation is role-specific, and generic refusal
 * messages so a hand-crafted id cannot be used to probe for what exists.
 *
 * On reveal specifically: the sign-in identity stores a bcrypt hash that
 * cannot be read back, so the credential shown comes from LITRACK's own sealed copy
 * (`User.passwordVaultCipher`, see `@/lib/auth/password-vault`). That copy is
 * written for `SCHOOL_HEAD` rows only and only for passwords set after that
 * feature shipped — for anything else the action refuses and the admin resets
 * instead. Every reveal is audit-logged; the privacy consequences of keeping
 * the copy at all are in `docs/privacy.md`.
 */

type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const RESET_RATE = { limit: 10, windowMs: 15 * 60 * 1000 } as const;
const IMPERSONATE_RATE = { limit: 10, windowMs: 15 * 60 * 1000 } as const;
/**
 * Deliberately tighter than a page of rows. Reading personal credentials is a
 * one-at-a-time, someone-called-for-help activity; a script walking all 333
 * schools to harvest passwords is not, and this is what stops it being cheap.
 */
const REVEAL_RATE = { limit: 20, windowMs: 15 * 60 * 1000 } as const;

/**
 * Who `impersonateUser` may sign the Super Admin in as. Deliberately an
 * allow-list rather than "everyone except X": a SUPER_ADMIN target is always
 * refused, and any role added to `UserRole` later stays refused until someone
 * decides where its session should land. DISTRICT_ADMIN is on the list so the
 * division office can see the district portal exactly as a district admin
 * does (docs/specs/district-admin.md I14); it lands on `/district` through
 * `roleHomePath`, never on a School Head or teacher page. Listed in the `WHERE`
 * of `impersonateUser`'s own lookup, so a disallowed target reads as "not
 * found" before `startImpersonation` — see the comment there for why its own
 * SUPER_ADMIN check stays as a second, independent guard.
 */
const IMPERSONATABLE_ROLES: readonly UserRole[] = ["TEACHER", "SCHOOL_HEAD", "DISTRICT_ADMIN"];

/**
 * Generic refusal for every target lookup below.
 *
 * "No such account", "that account was removed" and "that account is the wrong
 * role for this control" all read identically on purpose, so a hand-crafted
 * POST cannot be used to enumerate accounts or discover roles.
 */
function accountNotFound(detail: string): AppError {
  return resourceNotFound("Account", { detail });
}

// ── Passwords ──────────────────────────────────────────────────────────────

/**
 * Show the password a School Head is currently signing in with.
 *
 * Fetched on demand rather than rendered with the table on purpose: the list is
 * a page of live credentials, and shipping all of them to the browser so that
 * one might be clicked would put the rest in a page payload, in memory, and in
 * anything that caches it. One click, one password, one audit row.
 *
 * The `role !== "SCHOOL_HEAD"` refusal is access control, not presentation. The
 * read model maps every teacher and admin row to a "never stored" password cell
 * and the table renders no eye button for them — but neither of those stops a
 * hand-crafted POST carrying a teacher's id. This does. A teacher's password is
 * never sealed (`passwordChangeFields`), so there would be nothing to open even
 * if the lookup succeeded; refusing outright means that invariant is enforced
 * in two independent places instead of relied on in one.
 *
 * Returns the School ID when that is what the account is on — the same string
 * the row already prints — and refuses when nothing is on record, which is the
 * permanent state for any password chosen before sealing existed.
 */
export const revealSchoolHeadPassword = action("revealSchoolHeadPassword", async (
  formData: FormData
): Promise<ActionResult<{ password: string; setAt: string | null; isSchoolId: boolean }>> => {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = accountUserIdSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) return { ok: false, error: "Invalid account" };

  const rate = await checkRateLimit(`reveal:sh:${admin.id}`, REVEAL_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const target = await prisma.user.findFirst({
    where: {
      id: parsed.data.userId,
      deletedAt: null,
      school: { deletedAt: null },
    },
    select: {
      id: true,
      role: true,
      schoolId: true,
      passwordIsSchoolId: true,
      passwordVaultCipher: true,
      passwordVaultSetAt: true,
      school: { select: { id: true, schoolIdCode: true } },
    },
  });
  if (!target || target.role !== "SCHOOL_HEAD") {
    return { ok: false, error: "Account not found" };
  }
  const signInHead = target.schoolId ? await findSignInSchoolHead(target.schoolId) : null;
  if (signInHead?.id !== target.id) {
    return { ok: false, error: "Account not found" };
  }

  if (target.passwordIsSchoolId && target.school) {
    return {
      ok: true,
      data: {
        password: defaultSchoolHeadPassword(target.school.schoolIdCode),
        setAt: null,
        isSchoolId: true,
      },
    };
  }

  const opened = openPasswordWithSource(target.passwordVaultCipher);
  if (!opened) {
    // Three different causes — never recorded, vault key missing, key rotated
    // since sealing — and the same remedy for all of them, so they are not
    // distinguished here.
    return {
      ok: false,
      error: "This password is not on record. Use Reset to put the School ID back.",
    };
  }
  const { password } = opened;

  if (opened.usedLegacyKey) {
    // Opened under PASSWORD_VAULT_LEGACY_KEYS, not the current key. Re-seal
    // under the current key so the next reveal (and any future key rotation)
    // doesn't need the legacy key anymore. Best-effort: a failed re-seal must
    // never turn a successful reveal into a failed one, and the update itself
    // is fire-and-forget from the caller's perspective.
    const resealed = sealPassword(password);
    if (resealed) {
      // Compare-and-swap on the cipher that was opened, so a reset landing
      // between the read and this write is never overwritten.
      await prisma.user
        .updateMany({
          where: { id: target.id, passwordVaultCipher: target.passwordVaultCipher },
          data: { passwordVaultCipher: resealed },
        })
        .catch((err) => {
          // The message only: a Prisma error object carries the query
          // arguments, and these include the sealed cipher.
          console.error(
            "[accounts] re-seal after legacy-key reveal failed:",
            err instanceof Error ? err.message : String(err)
          );
        });
    }
  }

  await writeAudit({
    userId: admin.id,
    schoolId: target.schoolId,
    action: AUDIT_ACTIONS.SCHOOL_HEAD_PASSWORD_VIEWED,
    resource: "User",
    resourceId: target.id,
    // Ids and a timestamp. The password itself never goes near the audit log.
    metadata: {
      schoolId: target.schoolId,
      sealedAt: target.passwordVaultSetAt?.toISOString() ?? null,
    },
  });

  return {
    ok: true,
    data: {
      password,
      setAt: target.passwordVaultSetAt?.toISOString() ?? null,
      isSchoolId: false,
    },
  };
}, { verb: "show the password" });

/**
 * Put a School Head's password back to their school's School ID.
 *
 * `mustChangePassword` is cleared rather than set. The point of this action is
 * to hand the admin a login that works immediately — a forced set-password
 * interstitial on the very next request would defeat that, and the first-login
 * prompt is optional now anyway (see `skipPasswordChange`). `passwordIsSchoolId`
 * records that the live password is once again the School ID, which is what
 * lets the console show it.
 *
 * Contrast `resetTeacherPassword` below, which sets `mustChangePassword` and
 * writes no `isActive`. The two are deliberately different and the reasons are
 * given there.
 */
export const resetSchoolHeadPasswordToDefault = action("resetSchoolHeadPasswordToDefault", async (
  formData: FormData
): Promise<ActionResult<{ password: string }>> => {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = accountUserIdSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) return { ok: false, error: "Invalid account" };

  const rate = await checkRateLimit(`reset:sh:${admin.id}`, RESET_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const target = await prisma.user.findFirst({
    where: {
      id: parsed.data.userId,
      deletedAt: null,
      school: { deletedAt: null },
    },
    select: {
      id: true,
      role: true,
      authId: true,
      school: { select: { id: true, schoolIdCode: true } },
    },
  });
  // Same generic refusal as reveal: wrong role, removed, and nonexistent must
  // not be distinguishable. A school-less row cannot be reset either — the
  // School ID is where the password comes from.
  if (!target || target.role !== "SCHOOL_HEAD" || !target.school) {
    return { ok: false, error: "Account not found" };
  }
  const signInHead = await findSignInSchoolHead(target.school.id);
  if (signInHead?.id !== target.id) {
    return { ok: false, error: "Account not found" };
  }

  const password = defaultSchoolHeadPassword(target.school.schoolIdCode);
  // Hashed outside the transaction so a ~100 ms bcrypt never holds row locks.
  const hash = await hashPassword(password);
  const schoolId = target.school.id;

  // Credential, identity role and `User` flags commit together: a crash can no
  // longer leave the School ID live while `passwordIsSchoolId` says otherwise.
  await withIdentityFailureMapped(
    `resetSchoolHeadPasswordToDefault: password reset failed for user ${target.id}`,
    () =>
      prismaFresh.$transaction(async (tx) => {
        await setPassword(target.authId, { hash }, tx);
        await setRole(target.authId, "SCHOOL_HEAD", tx);
        await tx.user.update({
          where: { id: target.id },
          data: {
            passwordIsSchoolId: true,
            mustChangePassword: false,
            // The canonical-row guard above admits only an already-active head, so
            // this preserves the legacy post-state without resurrecting an older row.
            isActive: true,
            // Whatever the head had chosen no longer opens the account, so the sealed
            // copy of it is deleted rather than left to be revealed later.
            passwordVaultCipher: null,
            passwordVaultSetAt: null,
          },
        });
      })
  );
  await revokeAllSessions(target.authId);

  await writeAudit({
    userId: admin.id,
    schoolId,
    action: AUDIT_ACTIONS.SCHOOL_HEAD_PASSWORD_RESET_DEFAULT,
    resource: "User",
    resourceId: target.id,
    metadata: { schoolId },
  });

  revalidateAdminAccountPages();
  revalidateSchoolsList();
  // The School ID is not a secret — it is printed on the schools table and on
  // this console's own row — so returning it here reveals nothing new.
  return { ok: true, data: { password } };
}, { verb: "reset the password" });

export type ResetTeacherPasswordResult = { ok: true; data: { password: string } };
export type ResetDistrictAdminPasswordResult = { ok: true; data: { password: string } };

/**
 * Shared body of `resetTeacherPassword` and `resetDistrictAdminPassword`:
 * install an already-generated random credential on an account with no
 * mailbox that could carry a reset link, and flip it into "must change at
 * next sign-in" state. Factored out so the two paths cannot silently diverge
 * (docs/specs/district-admin.md 3.5, the "resetTeacherPassword pattern" row).
 *
 * Takes the password rather than generating one itself: the two callers use
 * different shapes on purpose (`generateActivationCredential` for a teacher,
 * the name-based `districtAdminPassword` for a district admin), so picking the
 * password stays the caller's decision.
 *
 * Three things it does NOT do, each easy to get wrong by copying the School
 * Head path:
 *  - It writes no `isActive`. `regenerateSchoolHeadCredential` does, and
 *    `docs/backlog.md` already logs that as a HIGH finding: a password reset
 *    must never silently resurrect an account someone switched off on
 *    purpose. Turning the account back on is a separate decision.
 *  - It does not call `sealPassword`. `passwordChangeFields` already refuses to
 *    seal a non-`SCHOOL_HEAD` role; the columns are written explicitly here
 *    because this path needs `mustChangePassword: true` and that helper
 *    hardcodes `false`.
 *  - It never writes the credential anywhere. Not the audit row, not a log
 *    line, not an error message — the caller returns it once, shown once, and
 *    it exists nowhere else. `mustChangePassword: true` retires it at first
 *    sign-in, because unlike the School ID a random string read out over the
 *    phone IS a secret in transit.
 */
async function issueRandomPassword(
  target: { id: string; authId: string; schoolId: string | null },
  role: "TEACHER" | "DISTRICT_ADMIN",
  password: string
): Promise<void> {
  // Hashed outside the transaction so a ~100 ms bcrypt never holds row locks.
  const hash = await hashPassword(password);

  // The forced change and the new password commit together. The old code had
  // to order them (flag first) because the password lived in another service;
  // in one transaction a one-time (for a District Admin, name-guessable)
  // password can never be live without `mustChangePassword`.
  await withIdentityFailureMapped(
    // `detail` names the account, never the credential — same rule as audit
    // metadata, and `detail` is stored in full on `/admin/errors`.
    `issueRandomPassword: ${role} password reset failed for user ${target.id}`,
    () =>
      prismaFresh.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: target.id },
          data: {
            mustChangePassword: true,
            passwordIsSchoolId: false,
            passwordVaultCipher: null,
            passwordVaultSetAt: null,
          },
        });
        await setPassword(target.authId, { hash }, tx);
        await setRole(target.authId, role, tx);
      })
  );
  await revokeAllSessions(target.authId);
}

/**
 * Run an admin credential write, turning `IDENTITY_NOT_FOUND` (the account has
 * a `User` row but no sign-in identity, e.g. a restored teacher) into the
 * `AUTH_PROVIDER_ERROR` these actions raised before the move to Better Auth
 * when the old auth provider answered `user_not_found`. Everything else propagates unchanged for `action()` to
 * classify. `detail` names the account, never the credential.
 */
async function withIdentityFailureMapped<T>(detail: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (isAppError(err) && err.code === "IDENTITY_NOT_FOUND") {
      throw new AppError("AUTH_PROVIDER_ERROR", { cause: err, detail });
    }
    throw err;
  }
}

/**
 * Issue a teacher a fresh random one-time credential.
 *
 * Random, not the School ID. The School ID is the School Head's credential and
 * it is printed on the schools table; handing it to teachers would create one
 * shared password across a school and give every teacher a value to try against
 * their head's account. The Salimama failure that pushed School Head resets
 * away from random credentials does not transfer — heads kept typing the School
 * ID they already knew, and a teacher has no such well-known default to fall
 * back on.
 *
 * Works for real and synthetic mailboxes alike, and nothing here branches on
 * which. A teacher with a real address should normally be sent through
 * `/forgot-password` instead, because that path never puts a credential in the
 * admin's hands at all; a teacher on `@school.local` has no mailbox, which is
 * the whole reason this action exists.
 */
export const resetTeacherPassword = action(
  "resetTeacherPassword",
  async (formData: FormData): Promise<ResetTeacherPasswordResult> => {
    const admin = await requireUser("SUPER_ADMIN");

    const rate = await checkRateLimit(`reset:teacher:${admin.id}`, RESET_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");

    const { userId } = parseInput(accountUserIdSchema, { userId: formData.get("userId") });

    // `role: "TEACHER"` is in the `where`, so a School Head or Super Admin id
    // is simply not found — one refusal, no branch that could be skipped.
    const target = await prisma.user.findFirst({
      where: {
        id: userId,
        role: "TEACHER",
        deletedAt: null,
        school: { deletedAt: null },
      },
      select: { id: true, authId: true, schoolId: true },
    });
    if (!target) throw accountNotFound(`resetTeacherPassword: no live TEACHER ${userId}`);

    const password = generateActivationCredential();
    await issueRandomPassword(target, "TEACHER", password);

    await writeAudit({
      userId: admin.id,
      schoolId: target.schoolId,
      action: AUDIT_ACTIONS.TEACHER_PASSWORD_RESET,
      resource: "User",
      resourceId: target.id,
      metadata: { schoolId: target.schoolId, via: "admin_accounts" },
    });

    revalidateAdminAccountPages();
    return { ok: true, data: { password } };
  },
  { verb: "reset that password" }
);

/**
 * Super Admin only: issue a district admin a fresh one-time credential.
 *
 * Their first password travelled in a CSV at account creation
 * (`scripts/create-district-admins.ts`) and, like a teacher's, must be
 * replaced rather than reused indefinitely — `skipPasswordChange` already
 * refuses `DISTRICT_ADMIN` for the same reason (spec 3.3). A district admin
 * has no `schoolId` (`User.schoolId` is null by design, spec 3.1), so the
 * audit row carries none, and the identity's role stays `DISTRICT_ADMIN` —
 * never widened to `SUPER_ADMIN`, which is exactly the privilege the account
 * must not gain from a password reset.
 *
 * The credential is `districtAdminPassword` (`First.Last1234`), not random:
 * owner decision, so older and busy users can remember and type it. It is
 * guessable from the name, which is why `mustChangePassword: true` retires it
 * at first sign-in and it is never written to the audit row.
 */
export const resetDistrictAdminPassword = action(
  "resetDistrictAdminPassword",
  async (formData: FormData): Promise<ResetDistrictAdminPasswordResult> => {
    const admin = await requireUser("SUPER_ADMIN");

    const rate = await checkRateLimit(`reset:district-admin:${admin.id}`, RESET_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");

    const { userId } = parseInput(accountUserIdSchema, { userId: formData.get("userId") });

    // `role: "DISTRICT_ADMIN"` is in the `where`, so any other role's id is
    // simply not found — same one-refusal shape as `resetTeacherPassword`.
    const target = await prisma.user.findFirst({
      where: { id: userId, role: "DISTRICT_ADMIN", deletedAt: null },
      select: { id: true, authId: true, schoolId: true, firstName: true, lastName: true },
    });
    if (!target) throw accountNotFound(`resetDistrictAdminPassword: no live DISTRICT_ADMIN ${userId}`);

    const password = districtAdminPassword(target);
    await issueRandomPassword(target, "DISTRICT_ADMIN", password);

    // Ids only, never the credential — same rule as `TEACHER_PASSWORD_RESET`.
    await writeAudit({
      userId: admin.id,
      schoolId: null,
      action: AUDIT_ACTIONS.DISTRICT_ADMIN_PASSWORD_RESET,
      resource: "User",
      resourceId: target.id,
      metadata: { via: "admin_accounts" },
    });

    revalidateAdminAccountPages();
    return { ok: true, data: { password } };
  },
  { verb: "reset that password" }
);

// ── Impersonation ──────────────────────────────────────────────────────────

const IMPERSONATION_TARGET_SELECT = {
  id: true,
  authId: true,
  role: true,
  isActive: true,
  approvalStatus: true,
  email: true,
  schoolId: true,
  fullName: true,
  school: { select: { name: true } },
} as const;

type ImpersonationTarget = {
  id: string;
  authId: string;
  role: UserRole;
  isActive: boolean;
  approvalStatus: TeacherApprovalStatus | null;
  email: string;
  schoolId: string | null;
  school: { name: string } | null;
};

/**
 * Sign the Super Admin into another account's session without changing its
 * password.
 *
 * Mechanism: Better Auth's admin plugin `impersonateUser` (through
 * `startImpersonationSession`). One response creates a two-hour session row
 * for the target with `impersonatedBy = <admin authId>`, keeps the admin's own
 * session token in the signed `litrack.admin_session` cookie, and swaps the
 * session cookie — no email is sent, which matters because School Head and
 * most teacher addresses are synthetic and undeliverable. The proof of
 * impersonation is that server-side `impersonatedBy`, never a client value.
 * `endImpersonation` reverses it.
 *
 * A PENDING teacher is a legitimate target: "why has this teacher been stuck on
 * Pending for a week" is one of the tickets this console exists to answer, and
 * the admin has to see what the teacher sees. `getCurrentUser` sends them to
 * `/pending-approval`, which mounts `ImpersonationNotice` so there is still a
 * way back.
 */
export const impersonateUser = action(
  "impersonateUser",
  async (formData: FormData): Promise<{ ok: true }> => {
    const admin = await requireUser("SUPER_ADMIN");

    const rate = await checkRateLimit(`impersonate:${admin.id}`, IMPERSONATE_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");

    const { userId, returnTo } = parseInput(impersonateUserSchema, {
      userId: formData.get("userId"),
      returnTo: formData.get("returnTo") ?? undefined,
    });

    // REFUSAL: a soft-deleted account is unreachable from here, enforced in the
    // `where` rather than by a branch afterwards. `getCurrentUser` signs such an
    // account out on its very next request — see the inactive guard below for
    // why that is fatal at this point in the flow.
    //
    // REFUSAL — ROLE ALLOW-LIST (I14): `role: { in: IMPERSONATABLE_ROLES }`
    // means a SUPER_ADMIN id is simply not found, the same
    // generic refusal every other mismatch gets here, and the reason
    // `startImpersonation`'s own SUPER_ADMIN check below is never reached for
    // this caller — it is kept there anyway as an independent guard for
    // `startTestLabSession`, whose own lookup restricts by fixed persona email
    // instead of by role.
    const target = await prisma.user.findFirst({
      where: {
        id: userId,
        role: { in: [...IMPERSONATABLE_ROLES] },
        deletedAt: null,
        OR: [{ schoolId: null }, { school: { deletedAt: null } }],
      },
      select: IMPERSONATION_TARGET_SELECT,
    });
    if (!target) throw accountNotFound(`impersonateUser: no live account ${userId}`);

    return startImpersonation(admin, target, {
      // `/teacher`, `/school-head` or `/district`. A district admin has no
      // school, so `requireAdminScope` there reads THEIR assignments: the
      // swapped session is theirs, not the Super Admin's, so the scope is
      // their districts and never the division.
      redirectTo: roleHomePath(target.role),
      returnTo,
      // Ids, a school name the admin already sees on the row, and the role.
      // `targetRole` is what lets the log answer "head or teacher" without a
      // join. Never the account's email or the person's name.
      auditMetadata: {
        schoolId: target.schoolId,
        schoolName: target.school?.name ?? null,
        targetRole: target.role,
      },
    });
  },
  { verb: "sign in as that account" }
);

/**
 * Page Test Lab: sign the Super Admin in as one of the demo school's test
 * personas (docs/test-lab-spec.md).
 *
 * The persona is looked up by its fixed synthetic email AND
 * `school: { isDemo: true, deletedAt: null }`, then `assertTestableSchool`
 * re-checks the school — so nothing a browser can send reaches a real account
 * through this action. Past the lookup it is `impersonateUser` exactly: same
 * rate-limit bucket, same refusals, same session swap, same audit action.
 */
export const startTestLabSession = action(
  "startTestLabSession",
  async (formData: FormData): Promise<{ ok: true }> => {
    const admin = await requireDeveloperAdmin("Page Test Lab");

    // Same bucket as `impersonateUser`: both mint sessions for other accounts.
    const rate = await checkRateLimit(`impersonate:${admin.id}`, IMPERSONATE_RATE);
    if (!rate.ok) throw tooManyAttempts(rate.retryAfterMs, "RATE_LIMITED");

    const { persona, next } = parseInput(startTestLabSessionSchema, {
      persona: formData.get("persona"),
      next: formData.get("next") ?? undefined,
    });

    const target = await prisma.user.findFirst({
      where: {
        email: testLabPersonaEmail(persona),
        role: testLabPersonaRole(persona),
        deletedAt: null,
        school: { isDemo: true, deletedAt: null },
      },
      select: IMPERSONATION_TARGET_SELECT,
    });
    if (!target) {
      throw new AppError("TEST_LAB_NOT_PREPARED", {
        detail: `startTestLabSession: no demo account for persona ${persona}`,
      });
    }
    await assertTestableSchool(target.schoolId);

    return startImpersonation(admin, target, {
      redirectTo: resolveTestLabNext(persona, next),
      // Ids and the role only.
      auditMetadata: {
        schoolId: target.schoolId,
        targetRole: target.role,
        source: "test-lab",
        persona,
      },
    });
  },
  { verb: "start the test session" }
);

/**
 * The shared body of `impersonateUser` and `startTestLabSession`: target
 * refusals, session swap, audit, redirect.
 *
 * Performs no authorization of its own — both callers have already passed
 * `requireUser("SUPER_ADMIN")`, the rate limit, and their own target lookup.
 * Must never be exported: this is a "use server" module.
 */
async function startImpersonation(
  admin: { id: string },
  target: ImpersonationTarget,
  options: {
    redirectTo: string;
    auditMetadata: Record<string, unknown>;
    /** Allowlisted cookie; only picks where "Return to admin" lands. */
    returnTo?: ImpersonationReturnTo;
  }
): Promise<never> {
  // REFUSAL — PRIVILEGE ESCALATION GUARD. One Super Admin may never take over
  // another's session, not even with a valid admin session of their own. The
  // audit trail's ability to say which admin did something depends entirely on
  // admin sessions being unforgeable from inside the app, and impersonating a
  // peer would let any admin act as any other with no row naming them. The
  // message stays generic — `what: "this account"` — so it says nothing the
  // list did not already show.
  if (target.role === "SUPER_ADMIN") {
    throw new AppError("AUTH_FORBIDDEN", {
      params: { what: "this account" },
      detail: `impersonateUser refused: target ${target.id} is SUPER_ADMIN`,
    });
  }

  if (target.role === "SCHOOL_HEAD") {
    const signInHead = target.schoolId ? await findSignInSchoolHead(target.schoolId) : null;
    if (signInHead?.id !== target.id) {
      throw accountNotFound(`impersonateUser: ${target.id} is not the sign-in head`);
    }
  }

  // REFUSAL — STRANDING GUARD, and it must come BEFORE the swap.
  // `getCurrentUser` signs out, on their very next request, every account it
  // will not serve — and that teardown deletes the impersonated session the
  // swap just installed. If the swap happened first, the admin would be
  // bounced to the login page with no session to return from, so no banner
  // and no "Return to admin", and the sign-out would also revoke every real
  // session the target holds.
  //
  // So this mirrors `getCurrentUserCached` exactly rather than approximating
  // it. A PENDING teacher is `isActive: false` from registration until
  // approval, but that function redirects them to `/pending-approval` and
  // returns BEFORE its inactive sign-out — they are never signed out, and that
  // page mounts the banner, so they are a legitimate target (spec §5.1). The
  // exemption is TEACHER + PENDING and nothing wider, because that is exactly
  // what its pending gate matches: an inactive School Head carrying a stray
  // PENDING status would still be signed out, so it is still refused.
  //
  // REJECTED is refused by name. `rejectTeacher` also writes `isActive: false`,
  // so the inactive check would catch it today — but that invariant is held by
  // one unrelated function, and a path that set the status without the flag
  // would reopen this hole. `getCurrentUser` signs REJECTED out on its own
  // terms, so it is refused here on its own terms.
  const pendingTeacher = target.role === "TEACHER" && target.approvalStatus === "PENDING";
  if (target.approvalStatus === "REJECTED" || (!target.isActive && !pendingTeacher)) {
    throw new AppError("ADMIN_IMPERSONATE_INACTIVE", {
      detail: `impersonateUser refused: target ${target.id} would be signed out (isActive=${target.isActive}, approvalStatus=${target.approvalStatus ?? "none"})`,
    });
  }

  // THE SWAP — one Better Auth response creates the impersonated session (with
  // `impersonatedBy` set server-side), stores the admin's own session in the
  // signed `litrack.admin_session` cookie, and replaces the session cookie.
  // There is no window where the browser holds the target's session without
  // the record of who to return to, so no ordering dance is needed. A refusal
  // from Better Auth throws before any cookie changes: a Super Admin target is
  // `AUTH_FORBIDDEN` (a third guard after the two above), and a target with no
  // sign-in identity maps to the `AUTH_PROVIDER_ERROR` this has always raised
  // when no session could be minted.
  await withIdentityFailureMapped(
    `impersonateUser: could not start a session for user ${target.id}`,
    () =>
      startImpersonationSession({
        targetAuthId: target.authId,
        ...(options.returnTo ? { returnTo: options.returnTo } : {}),
      })
  );

  await writeAudit({
    userId: admin.id,
    schoolId: target.schoolId,
    action: AUDIT_ACTIONS.IMPERSONATION_START,
    resource: "User",
    resourceId: target.id,
    metadata: options.auditMetadata,
  });

  redirect(options.redirectTo);
}

/**
 * Restore the Super Admin's own session and end the impersonated one.
 *
 * Callable from any impersonated page. Two things must both hold, and neither
 * alone is enough:
 *  - this request's session row, read fresh rather than from the cookie cache,
 *    carries `impersonatedBy` — set server-side by `impersonateUser` and never
 *    by anything the browser sends. The target signing in again on the same
 *    browser gets a new row without it, so they can never be handed the
 *    admin's session (invariant I7);
 *  - `impersonatedBy` still names a live, active Super Admin. Better Auth's
 *    `stopImpersonating` restores whatever admin session the signed cookie
 *    holds without re-checking the account, so this re-query is LITRACK's.
 *
 * That pair is this action's auth guard, and it is deliberately not
 * `requireUser`. It is stricter — specifically an impersonation session — and
 * `requireUser` would redirect a PENDING teacher and any `mustChangePassword`
 * account, which are exactly the accounts whose pages (`/pending-approval`,
 * `/account/set-password`) carry the banner.
 *
 * Single use: `stopImpersonating` deletes the impersonated session row, so a
 * copy of its cookie taken before the return opens nothing afterwards.
 */
export const endImpersonation = action("endImpersonation", async (): Promise<ActionResult> => {
  // REFUSAL — NOT AN IMPERSONATION. No session, or an ordinary one, gets one
  // answer, so this says nothing about whose session it is.
  const session = await getAuthSession({ fresh: true });
  const adminAuthId = session?.session.impersonatedBy;
  if (!session || !adminAuthId) return { ok: false, error: "Not impersonating" };

  // REFUSAL — THE ADMIN RE-QUERY. An admin deactivated or removed since the
  // impersonation began must not get their session back. The impersonated
  // session was theirs to hold, so it ends here too, together with the cookie
  // that would have restored them, and they sign in again normally.
  const adminUser = await prisma.user.findFirst({
    where: {
      authId: adminAuthId,
      role: "SUPER_ADMIN",
      deletedAt: null,
      isActive: true,
    },
    select: { id: true },
  });
  if (!adminUser) {
    await endCurrentSession();
    await expireImpersonationCookies();
    console.warn(
      `[impersonation] endImpersonation refused: impersonating admin ${adminAuthId} is no longer an active Super Admin`
    );
    return { ok: false, error: "That admin account is no longer available. Please sign in again." };
  }

  // Read before the swap: `stopImpersonationSession` deletes this session and
  // the return cookie. The target row only decides where to land and names the
  // audit row. No `deletedAt` filter — a demo school reset mid-session is still
  // a demo session; a hard-deleted row simply returns to the console.
  const [target, current] = await Promise.all([
    prisma.user.findFirst({
      where: { authId: session.user.id },
      select: { id: true, school: { select: { isDemo: true } } },
    }),
    readImpersonation(),
  ]);

  await stopImpersonationSession();

  await writeAudit({
    userId: adminUser.id,
    action: AUDIT_ACTIONS.IMPERSONATION_END,
    resource: "User",
    resourceId: target?.id ?? null,
  });

  redirect(
    impersonationReturnPath({
      targetSchoolIsDemo: target?.school?.isDemo === true,
      returnTo: current?.returnTo ?? undefined,
    })
  );
}, { verb: "return to your account" });

// ── Profile modal ──────────────────────────────────────────────────────────

export type AccountProfileSection = {
  id: string;
  name: string;
  gradeLabel: string;
  learnerCount: number;
};

export type AccountProfileActivity = {
  id: string;
  action: string;
  resource: string;
  resourceId: string | null;
  timestamp: string;
};

export type AccountProfile = {
  id: string;
  role: UserRole;
  fullName: string;
  isActive: boolean;
  mustChangePassword: boolean;
  profileCompleted: boolean;
  approvalStatus: TeacherApprovalStatus | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
  lastSeenReleaseVersion: string | null;
  school: { id: string; name: string; schoolIdCode: string } | null;
  signIn: AccountSignIn;
  /**
   * `User.lastLoginAt` (backfilled from the old `LOGIN_SUCCESS` audit rows).
   * Null means "no recorded sign-in", which is NOT the same as "never signed
   * in" — see section 7.3 of the spec.
   */
  lastSignInAt: string | null;
  /** Newest `LOGIN_DENIED` audit row — still recorded, it is a security event. */
  lastSignInDeniedAt: string | null;
  /**
   * Newest save per submission surface, for "have they submitted recently".
   * Read from the domain tables themselves (`recordedById` + `updatedAt`), not
   * from `AuditLog`, which no longer records routine saves.
   */
  submissions: {
    lastAttendanceWeekSaveAt: string | null;
    lastReadingLevelRecordAt: string | null;
    lastTermGradesSaveAt: string | null;
  };
  /** TEACHER only; null for a School Head or Super Admin. */
  advisory: { sections: AccountProfileSection[]; learnerCount: number } | null;
  /** TEACHER only; null for a School Head or Super Admin. */
  aral: {
    designation: string | null;
    isAralVolunteer: boolean;
    employmentType: EmploymentType | null;
    advisoryMode: AdvisoryMode | null;
    learnerCount: number;
  } | null;
  /**
   * The newest `RECENT_ACTIVITY_LIMIT` security audit rows this account
   * performed, newest first. Filtered to `SECURITY_AUDIT_ACTIONS` so rows left
   * over from before the 2026-09-27 security-only decision do not show under a
   * "security activity" heading. Raw action / resource strings — the dialog
   * renders them through the labels `/admin/audit` already has, rather than
   * inventing a second vocabulary.
   */
  recentActivity: AccountProfileActivity[];
};

export type GetAccountProfileResult = { ok: true; data: AccountProfile };

const RECENT_ACTIVITY_LIMIT = 20;

/** Newest save by one user on each submission surface; one statement. */
type SubmissionMaxRow = {
  attendanceAt: Date | null;
  readingLevelAt: Date | null;
  termGradesAt: Date | null;
};

/** Mirrors `accountSignIn` in `@/lib/admin/accounts`, which does not export it. */
function profileSignIn(user: {
  role: UserRole;
  email: string;
  username: string | null;
}): AccountSignIn {
  if (user.role === "SUPER_ADMIN") {
    return { kind: "username", value: user.username ?? user.email };
  }
  return { kind: "email", value: user.email, synthetic: isSyntheticEmail(user.email) };
}

/**
 * Everything the profile modal shows about one account.
 *
 * Loaded when a human clicks a row, never with the list. The list is pinned at
 * at most 3 Prisma calls regardless of row count and that bound is
 * load-bearing — an admin page that fanned out per row is what took
 * `/admin/archive` down against a pooler floored at `connection_limit=3`.
 * Prefetching twenty profiles so that one might be read would undo it and put
 * twenty people's data in a page payload besides.
 *
 * Cost of one open, fixed regardless of how many sections or learners the
 * person has:
 *  1. the user with `school`, `teacherProfile` and `advisorySections.gradeLevel`
 *     (`relationLoadStrategy: "join"`, so one SQL statement);
 *  2. `learner.groupBy` over the advisory section ids — one statement for all
 *     sections, never one count per section, and skipped entirely when there
 *     are none;
 *  3. `learner.count` for ARAL learners;
 *  4. `auditLog.findFirst` for the newest failed sign-in;
 *  5. one `$queryRaw` for the newest attendance / reading level / term grade
 *     save by this user (three `MAX("updatedAt")` subselects, each served by
 *     that table's `recordedById` index);
 *  6. `auditLog.findMany` for recent security activity.
 *
 * "Last signed in" is `User.lastLoginAt`, read by call 1.
 *
 * Six calls for a teacher with advisory sections, five without, four for a
 * School Head or Super Admin (2 and 3 are skipped by the role branch). Calls
 * 2–6 share one `Promise.all`. Nothing here scales with row count.
 *
 * Writes no audit row, by decision recorded in spec section 9: it exposes no
 * credential and no learner PII — counts, and the staff member's own
 * professional profile, which a School Head already sees unaudited at
 * `/school-head/teachers`.
 */
export const getAccountProfile = action(
  "getAccountProfile",
  async (userId: string): Promise<GetAccountProfileResult> => {
    await requireUser("SUPER_ADMIN");

    // The id arrives from a click in the browser, so it is boundary input and
    // gets the same treatment as a form field.
    const parsed = parseInput(accountUserIdSchema, { userId });

    // Same join-strategy shape `listAralTutors` already runs in production: a
    // to-one relation plus a filtered, ordered to-many, resolved as one SQL
    // statement.
    const user = await prisma.user.findFirst({
      relationLoadStrategy: "join",
      where: {
        id: parsed.userId,
        deletedAt: null,
        OR: [{ schoolId: null }, { school: { deletedAt: null } }],
      },
      select: {
        id: true,
        role: true,
        fullName: true,
        firstName: true,
        lastName: true,
        email: true,
        username: true,
        schoolId: true,
        isActive: true,
        mustChangePassword: true,
        profileCompleted: true,
        approvalStatus: true,
        approvedAt: true,
        rejectedAt: true,
        createdAt: true,
        lastSeenReleaseVersion: true,
        lastLoginAt: true,
        school: { select: { id: true, name: true, schoolIdCode: true } },
        teacherProfile: {
          select: { designation: true, employmentType: true, advisoryMode: true },
        },
        advisorySections: {
          where: { deletedAt: null },
          select: { id: true, name: true, gradeLevel: { select: { type: true } } },
          orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }],
        },
      },
    });
    if (!user) throw accountNotFound(`getAccountProfile: no live account ${parsed.userId}`);

    const isTeacher = user.role === "TEACHER";
    const sectionIds = isTeacher ? user.advisorySections.map((s) => s.id) : [];

    const [sectionCounts, aralLearnerCount, lastDenied, submissionRows, recentActivity] = await Promise.all([
      sectionIds.length > 0
        ? prisma.learner.groupBy({
            by: ["sectionId"],
            where: { sectionId: { in: sectionIds }, deletedAt: null },
            _count: true,
          })
        : Promise.resolve([]),
      // `schoolId` stays in the `where` even though `aralTeacherId` alone would
      // be correct: it is the leading column of
      // `@@index([schoolId, aralTeacherId, isAralLearner, deletedAt])`, and
      // without it the index cannot serve this count.
      isTeacher && user.schoolId
        ? prisma.learner.count({
            where: {
              schoolId: user.schoolId,
              aralTeacherId: user.id,
              isAralLearner: true,
              deletedAt: null,
            },
          })
        : Promise.resolve(0),
      prisma.auditLog.findFirst({
        where: { userId: user.id, action: AUDIT_ACTIONS.LOGIN_DENIED },
        orderBy: { timestamp: "desc" },
        select: { timestamp: true },
      }),
      // Not tenant-scoped by `schoolId` on purpose: this is a Super Admin-only
      // read of one account's own writes, keyed on `recordedById`.
      prisma.$queryRaw<SubmissionMaxRow[]>`
        SELECT
          (SELECT MAX("updatedAt") FROM "Attendance" WHERE "recordedById" = ${user.id}) AS "attendanceAt",
          (SELECT MAX("updatedAt") FROM "ReadingLevelRecord" WHERE "recordedById" = ${user.id}) AS "readingLevelAt",
          (SELECT MAX("updatedAt") FROM "TermGrade" WHERE "recordedById" = ${user.id}) AS "termGradesAt"
      `,
      prisma.auditLog.findMany({
        where: { userId: user.id, action: { in: [...SECURITY_AUDIT_ACTIONS] } },
        orderBy: { timestamp: "desc" },
        take: RECENT_ACTIVITY_LIMIT,
        select: {
          id: true,
          action: true,
          resource: true,
          resourceId: true,
          timestamp: true,
        },
      }),
    ]);

    const countBySection = new Map(
      sectionCounts.map((row) => [row.sectionId, row._count] as const)
    );
    const sections: AccountProfileSection[] = user.advisorySections.map((section) => ({
      id: section.id,
      name: section.name,
      gradeLabel: GRADE_LEVEL_LABELS[section.gradeLevel.type] ?? section.gradeLevel.type,
      learnerCount: countBySection.get(section.id) ?? 0,
    }));

    const submissionMax = submissionRows[0];
    const iso = (value: Date | null | undefined): string | null =>
      value ? new Date(value).toISOString() : null;

    return {
      ok: true,
      data: {
        id: user.id,
        role: user.role,
        fullName: user.fullName || `${user.firstName} ${user.lastName}`.trim(),
        isActive: user.isActive,
        mustChangePassword: user.mustChangePassword,
        profileCompleted: user.profileCompleted,
        approvalStatus: user.approvalStatus,
        approvedAt: user.approvedAt?.toISOString() ?? null,
        rejectedAt: user.rejectedAt?.toISOString() ?? null,
        createdAt: user.createdAt.toISOString(),
        lastSeenReleaseVersion: user.lastSeenReleaseVersion,
        school: user.school,
        signIn: profileSignIn(user),
        lastSignInAt: iso(user.lastLoginAt),
        lastSignInDeniedAt: iso(lastDenied?.timestamp),
        submissions: {
          lastAttendanceWeekSaveAt: iso(submissionMax?.attendanceAt),
          lastReadingLevelRecordAt: iso(submissionMax?.readingLevelAt),
          lastTermGradesSaveAt: iso(submissionMax?.termGradesAt),
        },
        advisory: isTeacher
          ? {
              sections,
              learnerCount: sections.reduce((total, s) => total + s.learnerCount, 0),
            }
          : null,
        // An ARAL tutor is a TEACHER with learners pointing at them, not a
        // separate role, so there is nothing else to read.
        aral: isTeacher
          ? {
              designation: user.teacherProfile?.designation ?? null,
              isAralVolunteer: isAralVolunteerDesignation(user.teacherProfile?.designation),
              employmentType: user.teacherProfile?.employmentType ?? null,
              advisoryMode: user.teacherProfile?.advisoryMode ?? null,
              learnerCount: aralLearnerCount,
            }
          : null,
        recentActivity: recentActivity.map((row) => ({
          id: row.id,
          action: row.action,
          resource: row.resource,
          resourceId: row.resourceId,
          timestamp: row.timestamp.toISOString(),
        })),
      },
    };
  },
  { verb: "load that profile" }
);
