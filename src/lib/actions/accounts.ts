"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type {
  AdvisoryMode,
  EmploymentType,
  TeacherApprovalStatus,
  UserRole,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicEnv } from "@/lib/supabase/env";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidateSchoolsList } from "@/lib/cache/revalidate";
import { defaultSchoolHeadPassword } from "@/lib/auth/school-head-password";
import { findSignInSchoolHead } from "@/lib/auth/school-head-sign-in";
import { openPassword } from "@/lib/auth/password-vault";
import { generateActivationCredential } from "@/lib/auth/credentials";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { isAralVolunteerDesignation } from "@/lib/teachers/scope";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { action } from "@/lib/errors/action";
import { AppError, resourceNotFound, tooManyAttempts } from "@/lib/errors/app-error";
import { mapSupabaseAuthError } from "@/lib/errors/supabase";
import { parseInput } from "@/lib/errors/validation";
import { accountUserIdSchema } from "@/lib/validators/accounts.schema";
import type { AccountSignIn } from "@/lib/admin/accounts";
import {
  checkCurrentSession,
  checkSessionToken,
  clearImpersonationCookie,
  readImpersonationTicket,
  setImpersonationCookie,
} from "@/lib/auth/impersonation";

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
 * On reveal specifically: Supabase Auth stores a bcrypt hash that no API reads
 * back, so the credential shown comes from LITRACK's own sealed copy
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
export async function revealSchoolHeadPassword(
  formData: FormData
): Promise<ActionResult<{ password: string; setAt: string | null; isSchoolId: boolean }>> {
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

  const password = openPassword(target.passwordVaultCipher);
  if (!password) {
    // Three different causes — never recorded, vault key missing, key rotated
    // since sealing — and the same remedy for all of them, so they are not
    // distinguished here.
    return {
      ok: false,
      error: "This password is not on record. Use Reset to put the School ID back.",
    };
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
}

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
export async function resetSchoolHeadPasswordToDefault(
  formData: FormData
): Promise<ActionResult<{ password: string }>> {
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
  const supabaseAdmin = createSupabaseAdminClient();
  const { error } = await supabaseAdmin.auth.admin.updateUserById(target.authId, {
    password,
    app_metadata: { role: "SCHOOL_HEAD", schoolId: target.school.id },
  });
  if (error) return { ok: false, error: "Failed to reset password" };

  await prisma.user.update({
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

  await writeAudit({
    userId: admin.id,
    schoolId: target.school.id,
    action: AUDIT_ACTIONS.SCHOOL_HEAD_PASSWORD_RESET_DEFAULT,
    resource: "User",
    resourceId: target.id,
    metadata: { schoolId: target.school.id },
  });

  revalidatePath("/admin/accounts");
  revalidateSchoolsList();
  // The School ID is not a secret — it is printed on the schools table and on
  // this console's own row — so returning it here reveals nothing new.
  return { ok: true, data: { password } };
}

export type ResetTeacherPasswordResult = { ok: true; data: { password: string } };

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
 *
 * Three things it does NOT do, each easy to get wrong by copying the School
 * Head path:
 *  - It writes no `isActive`. `regenerateSchoolHeadCredential` does, and
 *    `docs/backlog.md` already logs that as a HIGH finding: a password reset
 *    must never silently resurrect an account a School Head switched off on
 *    purpose. Turning the account back on is the School Head's decision and
 *    lives on their roster, not here.
 *  - It does not call `sealPassword`. `passwordChangeFields` already refuses to
 *    seal a non-`SCHOOL_HEAD` role; the columns are written explicitly here
 *    because this path needs `mustChangePassword: true` and that helper
 *    hardcodes `false`.
 *  - It never writes the credential anywhere. Not the audit row, not a log
 *    line, not an error message — it is returned once, shown once, and exists
 *    nowhere else. `mustChangePassword: true` retires it at first sign-in,
 *    because unlike the School ID a random string read out over the phone IS a
 *    secret in transit.
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

    const supabaseAdmin = createSupabaseAdminClient();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(target.authId, {
      password,
      app_metadata: { role: "TEACHER", schoolId: target.schoolId },
    });
    if (error) {
      // `detail` names the account, never the credential — same rule as audit
      // metadata, and `detail` is stored in full on `/admin/errors`.
      throw new AppError(mapSupabaseAuthError(error, "server"), {
        cause: error,
        detail: `teacher password reset failed for user ${target.id}`,
      });
    }

    await prisma.user.update({
      where: { id: target.id },
      data: {
        mustChangePassword: true,
        passwordIsSchoolId: false,
        passwordVaultCipher: null,
        passwordVaultSetAt: null,
      },
    });

    await writeAudit({
      userId: admin.id,
      schoolId: target.schoolId,
      action: AUDIT_ACTIONS.TEACHER_PASSWORD_RESET,
      resource: "User",
      resourceId: target.id,
      metadata: { schoolId: target.schoolId, via: "admin_accounts" },
    });

    revalidatePath("/admin/accounts");
    return { ok: true, data: { password } };
  },
  { verb: "reset that password" }
);

// ── Impersonation ──────────────────────────────────────────────────────────

/**
 * Sign the Super Admin into another account's session without changing its
 * password.
 *
 * Mechanism: `admin.generateLink` mints a magic-link token for the target
 * account (it generates only — Supabase sends no email, which matters because
 * School Head and most teacher addresses are synthetic and undeliverable),
 * `verifyOtp` redeems it on a detached client, and `setSession` installs the
 * result on the SSR client so the session cookies land on this response.
 *
 * The admin's own session is replaced by that, so a signed ticket recording who
 * they were — and which session it is valid from — is written before the
 * install. See `@/lib/auth/impersonation` for why it is signed and bound, and
 * the ORDERING comment below for why minting and installing are split.
 * `endImpersonation` redeems the ticket in reverse.
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

    const { userId } = parseInput(accountUserIdSchema, { userId: formData.get("userId") });

    // REFUSAL: a soft-deleted account is unreachable from here, enforced in the
    // `where` rather than by a branch afterwards. `getCurrentUser` signs such an
    // account out on its very next request — see the inactive guard below for
    // why that is fatal at this point in the flow.
    const target = await prisma.user.findFirst({
      where: {
        id: userId,
        deletedAt: null,
        OR: [{ schoolId: null }, { school: { deletedAt: null } }],
      },
      select: {
        id: true,
        role: true,
        isActive: true,
        approvalStatus: true,
        email: true,
        schoolId: true,
        fullName: true,
        school: { select: { name: true } },
      },
    });
    if (!target) throw accountNotFound(`impersonateUser: no live account ${userId}`);

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
    // will not serve. If the swap happened first, the admin's own session would
    // already be gone by the time that fired: they would be bounced to the login
    // page holding an impersonation ticket they can no longer redeem, with no
    // way back short of an operator clearing a cookie they cannot see.
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

    // ORDERING — mint, bind, then install. The ticket still lands before the
    // swap, and here is why that order holds even though the ticket now needs a
    // session id that does not exist until the session does.
    //
    // Stranding is the failure this sequence prevents: the browser holding the
    // target's session with no ticket, so no banner and no way back. Today's
    // answer was "write the ticket first", and it still is — the session is
    // minted OFF the response (a detached client, no cookies touched), its
    // `session_id` is read, the ticket is written bound to it, and only then is
    // the session installed into this response's cookies. Every exit leaves one
    // of two coherent states:
    //  - the admin's own session, and no ticket that can restore anything: a
    //    failure while minting writes nothing; a failed install clears the
    //    ticket; and even a throw between the two leaves a ticket bound to a
    //    session this browser never received, which `endImpersonation` refuses;
    //  - the target's session plus a ticket bound to exactly that session.
    // There is no point at which the target's session is in the cookies without
    // its ticket, and no ticket ever exists without a binding.
    //
    // The rejected alternative — write an unbound placeholder, swap, overwrite
    // with the bound ticket — leaves an unredeemable placeholder in precisely the
    // window the placeholder was there to cover.
    const minted = await mintSessionFor(target.email);
    if (!minted) {
      throw new AppError("AUTH_PROVIDER_ERROR", {
        detail: `impersonateUser: could not mint a session for user ${target.id}`,
      });
    }

    await setImpersonationCookie({
      adminAuthId: admin.authId,
      adminUserId: admin.id,
      targetUserId: target.id,
      sessionId: minted.sessionId,
    });

    const supabase = await createSupabaseServerClient();
    const { error: installError } = await supabase.auth.setSession({
      access_token: minted.session.access_token,
      refresh_token: minted.session.refresh_token,
    });
    if (installError) {
      await clearImpersonationCookie();
      throw new AppError("AUTH_PROVIDER_ERROR", {
        cause: installError,
        detail: `impersonateUser: session install failed for user ${target.id}`,
      });
    }

    await writeAudit({
      userId: admin.id,
      schoolId: target.schoolId,
      action: AUDIT_ACTIONS.IMPERSONATION_START,
      resource: "User",
      resourceId: target.id,
      // Ids, a school name the admin already sees on the row, and the role.
      // `targetRole` is what lets the log answer "head or teacher" without a
      // join. Never the account's email or the person's name.
      metadata: {
        schoolId: target.schoolId,
        schoolName: target.school?.name ?? null,
        targetRole: target.role,
      },
    });

    redirect(target.role === "TEACHER" ? "/teacher" : "/school-head");
  },
  { verb: "sign in as that account" }
);

/**
 * Restore the Super Admin's own session and drop the ticket.
 *
 * Callable from any impersonated page. Two things must both hold, and neither
 * alone is enough:
 *  - the ticket, which names WHO gets restored, is validly signed and unexpired
 *    — without the signature this would sign the caller in as whichever admin
 *    they named;
 *  - the caller IS the session `impersonateUser` minted, which is what decides
 *    WHETHER they may. The ticket names the target, and the target can sign in
 *    again on the same browser, so matching on user id would hand that person
 *    the admin's session. Matching on the verified, live `session_id` refuses
 *    them: a fresh login is a fresh session.
 *
 * That binding check is this action's auth guard, and it is deliberately not
 * `requireUser`. It is stricter — a live session that is specifically the bound
 * one — and `requireUser` would redirect a PENDING teacher and any
 * `mustChangePassword` account, which are exactly the accounts whose pages
 * (`/pending-approval`, `/account/set-password`) carry the banner.
 */
export async function endImpersonation(): Promise<ActionResult> {
  const ticket = await readImpersonationTicket();
  if (!ticket) return { ok: false, error: "Not impersonating" };

  // REFUSAL — SESSION BINDING. A caller who is definitely not the bound session
  // — no session, a token that fails verification or was revoked, or simply a
  // different session — gets the same answer as having no ticket, so this says
  // nothing about whether one exists or whom it names. The cookie goes with
  // the refusal: nobody but its session could ever redeem it.
  //
  // An auth server that could not be reached is NOT that answer, and the ticket
  // is kept. Clearing it on a network blip would leave the real admin signed in
  // as the target with no way back — the stranding the ordering in
  // `impersonateUser` exists to prevent — and keeping it costs nothing, because
  // it still opens only for its own session. Nothing is restored either way.
  const supabase = await createSupabaseServerClient();
  const caller = await checkCurrentSession(supabase.auth);
  if (caller.status === "unavailable") {
    return { ok: false, error: "Could not start that session. Please try again." };
  }
  if (caller.status === "none" || caller.sessionId !== ticket.sessionId) {
    await clearImpersonationCookie();
    console.warn(
      `[impersonation] endImpersonation refused: caller is not the bound session (admin ${ticket.adminUserId}, target ${ticket.targetUserId})`
    );
    return { ok: false, error: "Not impersonating" };
  }

  const adminUser = await prisma.user.findFirst({
    where: {
      id: ticket.adminUserId,
      authId: ticket.adminAuthId,
      role: "SUPER_ADMIN",
      deletedAt: null,
      isActive: true,
    },
    select: { id: true, email: true },
  });
  // A ticket naming an admin who has since been deactivated or removed must not
  // restore anything. Drop it and let them log in normally.
  if (!adminUser) {
    await clearImpersonationCookie();
    return { ok: false, error: "That admin account is no longer available. Please sign in again." };
  }

  const switched = await switchSessionTo(supabase, adminUser.email);
  if (!switched.ok) return switched;

  await clearImpersonationCookie();

  // Single use. Only now, with the admin restored: revoking first would mean a
  // failed switch left the admin with no session at all. The token is the one
  // the binding check just verified as the bound session.
  await revokeImpersonationSession(caller.accessToken, {
    adminUserId: ticket.adminUserId,
    targetUserId: ticket.targetUserId,
  });

  await writeAudit({
    userId: adminUser.id,
    action: AUDIT_ACTIONS.IMPERSONATION_END,
    resource: "User",
    resourceId: ticket.targetUserId,
  });

  redirect("/admin/accounts");
}

type AuthClient = SupabaseClient["auth"];

/**
 * Replace the current request's session cookies with a session for `email`.
 *
 * Takes the caller's SSR client rather than making its own, so the binding
 * check's possible token refresh and this swap write through one cookie store.
 *
 * Only `endImpersonation` calls it, after the session-binding check and the
 * live-Super-Admin re-query — this helper performs no authorization of its own
 * and must never be exported.
 */
async function switchSessionTo(
  supabase: { auth: AuthClient },
  email: string
): Promise<ActionResult> {
  const supabaseAdmin = createSupabaseAdminClient();

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    console.error("[impersonation] generateLink failed:", error);
    return { ok: false, error: "Could not start that session. Please try again." };
  }

  const { error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError) {
    console.error("[impersonation] verifyOtp failed:", verifyError);
    return { ok: false, error: "Could not start that session. Please try again." };
  }

  return { ok: true };
}

/**
 * Mint a session for `email` WITHOUT touching this request's cookies, and read
 * the `session_id` the impersonation ticket is bound to.
 *
 * Redeemed on a throwaway anon client with in-memory storage, never on the SSR
 * client: when this returns, the browser's session is still the admin's, which
 * is what lets `impersonateUser` write the bound ticket before anything about
 * the session changes. The client is dropped with the function, and the tokens
 * with it, unless `impersonateUser` installs them.
 *
 * Null on any failure — `impersonateUser` owns the one error it turns into.
 * Called only after `requireUser("SUPER_ADMIN")` and the target refusals; it
 * performs no authorization of its own and must never be exported.
 */
async function mintSessionFor(
  email: string
): Promise<{ session: Session; sessionId: string } | null> {
  const supabaseAdmin = createSupabaseAdminClient();
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    console.error("[impersonation] generateLink failed:", error);
    return null;
  }

  const env = getSupabasePublicEnv();
  if (!env.ok) {
    throw new AppError("CONFIG_MISSING", {
      detail: "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not set",
      context: { reason: "supabase_env_missing" },
    });
  }
  const detached = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: verified, error: verifyError } = await detached.auth.verifyOtp({
    token_hash: data.properties.hashed_token,
    type: "magiclink",
  });
  if (verifyError || !verified.session) {
    console.error("[impersonation] verifyOtp failed:", verifyError);
    return null;
  }

  const claim = await checkSessionToken(detached.auth, verified.session.access_token);
  if (claim.status !== "live") {
    // Fail closed: a ticket bound to nothing would be refused on return, so
    // starting an impersonation that cannot end is worse than not starting.
    console.error(`[impersonation] minted session has no verifiable session_id (${claim.status})`);
    return null;
  }

  return { session: verified.session, sessionId: claim.sessionId };
}

/**
 * End the impersonation session server-side, after a successful return.
 *
 * `admin.signOut(jwt, "local")` is `POST /logout?scope=local` authenticated by
 * that session's own token, which GoTrue answers with `LogoutSession` —
 * `DELETE FROM sessions WHERE id = <that session>`. Only that one session: the
 * target's own phone and laptop are untouched. Its refresh tokens go with the
 * row, and every later `getUser` on its access token is `session_not_found`,
 * which is what makes the ticket single-use — a copy of both cookies taken
 * before the return now fails the binding check in `endImpersonation`.
 *
 * Never throws and returns nothing. The admin is already restored when this
 * runs, so a failed revoke must not turn that into a reported failure; it is
 * logged, and the ticket is already gone from this browser. What a failure
 * leaves is the pre-hardening state: that session lives until it expires.
 */
async function revokeImpersonationSession(
  accessToken: string,
  ids: { adminUserId: string; targetUserId: string }
): Promise<void> {
  try {
    const { error } = await createSupabaseAdminClient().auth.admin.signOut(accessToken, "local");
    if (error) {
      console.error(
        `[impersonation] revoking the impersonation session failed after return (admin ${ids.adminUserId}, target ${ids.targetUserId}):`,
        error
      );
    }
  } catch (err) {
    console.error(
      `[impersonation] revoking the impersonation session threw after return (admin ${ids.adminUserId}, target ${ids.targetUserId}):`,
      err
    );
  }
}

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
   * Newest `LOGIN_SUCCESS` / `LOGIN_DENIED` rows. Null means "no recorded
   * sign-in", which is NOT the same as "never signed in" — see section 7.3 of
   * the spec. `AuditLog` is never purged, so in practice it is the whole
   * history of the account.
   */
  lastSignInAt: string | null;
  lastSignInDeniedAt: string | null;
  /** Newest save per submission surface, for "have they submitted recently". */
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
   * The newest `RECENT_ACTIVITY_LIMIT` audit rows for this account, newest
   * first. Raw action / resource strings — the dialog renders them through the
   * labels `/admin/audit` already has, rather than inventing a second
   * vocabulary.
   */
  recentActivity: AccountProfileActivity[];
};

export type GetAccountProfileResult = { ok: true; data: AccountProfile };

/**
 * The six audit actions the profile summarises with one `groupBy`.
 *
 * Two sign-in outcomes and four submission surfaces, answered together by a
 * single statement served by the existing `@@index([userId, timestamp])`. Kept
 * as a plain module constant rather than exported: a `"use server"` module may
 * export nothing but async functions.
 */
const PROFILE_TIMELINE_ACTIONS: readonly string[] = [
  AUDIT_ACTIONS.LOGIN_SUCCESS,
  AUDIT_ACTIONS.LOGIN_DENIED,
  AUDIT_ACTIONS.ATTENDANCE_WEEK_SAVE,
  AUDIT_ACTIONS.READING_LEVEL_RECORD,
  AUDIT_ACTIONS.READING_LEVEL_BULK_RECORD,
  AUDIT_ACTIONS.TERM_GRADES_BULK_SAVE,
];

const RECENT_ACTIVITY_LIMIT = 20;

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
 *  4. `auditLog.groupBy` for sign-in and submission timestamps;
 *  5. `auditLog.findMany` for recent activity.
 *
 * Five calls for a teacher with advisory sections, four without, three for a
 * School Head or Super Admin (2 and 3 are skipped by the role branch). Calls
 * 2–5 share one `Promise.all`. Nothing here scales with row count.
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

    const [sectionCounts, aralLearnerCount, timeline, recentActivity] = await Promise.all([
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
      prisma.auditLog.groupBy({
        by: ["action"],
        where: { userId: user.id, action: { in: [...PROFILE_TIMELINE_ACTIONS] } },
        _max: { timestamp: true },
      }),
      prisma.auditLog.findMany({
        where: { userId: user.id },
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

    const latest = new Map(
      timeline.map((row) => [row.action, row._max.timestamp?.toISOString() ?? null] as const)
    );
    const at = (auditAction: string): string | null => latest.get(auditAction) ?? null;

    // The monthly grid and the one-off record are the same fact to a person
    // asking "has this teacher entered reading levels", so the newer wins.
    const readingLevelAt = [
      at(AUDIT_ACTIONS.READING_LEVEL_RECORD),
      at(AUDIT_ACTIONS.READING_LEVEL_BULK_RECORD),
    ]
      .filter((value): value is string => value !== null)
      .sort()
      .pop();

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
        lastSignInAt: at(AUDIT_ACTIONS.LOGIN_SUCCESS),
        lastSignInDeniedAt: at(AUDIT_ACTIONS.LOGIN_DENIED),
        submissions: {
          lastAttendanceWeekSaveAt: at(AUDIT_ACTIONS.ATTENDANCE_WEEK_SAVE),
          lastReadingLevelRecordAt: readingLevelAt ?? null,
          lastTermGradesSaveAt: at(AUDIT_ACTIONS.TERM_GRADES_BULK_SAVE),
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
