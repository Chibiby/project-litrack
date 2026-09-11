"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { revalidateSchoolsList } from "@/lib/cache/revalidate";
import { defaultSchoolHeadPassword } from "@/lib/auth/school-head-password";
import { openPassword } from "@/lib/auth/password-vault";
import {
  clearImpersonationCookie,
  readImpersonationTicket,
  setImpersonationCookie,
} from "@/lib/auth/impersonation";
import { revalidatePath } from "next/cache";

/**
 * Super Admin school-account console.
 *
 * Three ways in to a School Head's account, in increasing order of how much
 * they disturb the person on the other end:
 *  - `revealSchoolHeadPassword` shows the password the head is using right now,
 *    when LITRACK holds a sealed copy of it. Nothing changes for the head.
 *  - `impersonateSchoolHead` takes over the session without touching the
 *    password at all, so their own login keeps working.
 *  - `resetSchoolHeadPasswordToDefault` puts the School ID back on the account,
 *    which invalidates whatever they had chosen.
 *
 * On reveal specifically: Supabase Auth stores a bcrypt hash that no API reads
 * back, so the credential shown comes from LITRACK's own sealed copy
 * (`User.passwordVaultCipher`, see `@/lib/auth/password-vault`). That copy only
 * exists for passwords set after that feature shipped — for anything older the
 * action refuses and the admin resets instead. Every reveal is audit-logged;
 * the privacy consequences of keeping the copy at all are in `docs/privacy.md`.
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

const schoolIdInput = z.object({ schoolId: z.string().uuid() });

/** The single School Head account for a school, or null. */
async function findSchoolHead(schoolId: string) {
  return prisma.user.findFirst({
    where: { schoolId, role: "SCHOOL_HEAD", deletedAt: null },
    select: { id: true, authId: true, email: true, fullName: true },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Show the password a School Head is currently signing in with.
 *
 * Fetched on demand rather than rendered with the table on purpose: the list is
 * 10 rows of live credentials, and shipping all ten to the browser so that one
 * of them might be clicked would put nine passwords in a page payload, in
 * memory, and in anything that caches it. One click, one password, one audit
 * row.
 *
 * Returns the School ID when that is what the account is on — the same string
 * the row already prints — and refuses when nothing is on record, which is the
 * permanent state for any password chosen before sealing existed.
 */
export async function revealSchoolHeadPassword(
  formData: FormData
): Promise<ActionResult<{ password: string; setAt: string | null; isSchoolId: boolean }>> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = schoolIdInput.safeParse({ schoolId: formData.get("schoolId") });
  if (!parsed.success) return { ok: false, error: "Invalid school" };

  const rate = await checkRateLimit(`reveal:sh:${admin.id}`, REVEAL_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await prisma.school.findFirst({
    where: { id: parsed.data.schoolId, deletedAt: null },
    select: { id: true, schoolIdCode: true },
  });
  if (!school) return { ok: false, error: "School not found" };

  const head = await prisma.user.findFirst({
    where: { schoolId: school.id, role: "SCHOOL_HEAD", deletedAt: null },
    select: {
      id: true,
      passwordIsSchoolId: true,
      passwordVaultCipher: true,
      passwordVaultSetAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  if (!head) return { ok: false, error: "School Head account not found" };

  if (head.passwordIsSchoolId) {
    return {
      ok: true,
      data: {
        password: defaultSchoolHeadPassword(school.schoolIdCode),
        setAt: null,
        isSchoolId: true,
      },
    };
  }

  const password = openPassword(head.passwordVaultCipher);
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
    schoolId: school.id,
    action: AUDIT_ACTIONS.SCHOOL_HEAD_PASSWORD_VIEWED,
    resource: "User",
    resourceId: head.id,
    // Ids and a timestamp. The password itself never goes near the audit log.
    metadata: { schoolId: school.id, sealedAt: head.passwordVaultSetAt?.toISOString() ?? null },
  });

  return {
    ok: true,
    data: {
      password,
      setAt: head.passwordVaultSetAt?.toISOString() ?? null,
      isSchoolId: false,
    },
  };
}

/**
 * Put a School Head's password back to the school's School ID.
 *
 * `mustChangePassword` is cleared rather than set. The point of this action is
 * to hand the admin a login that works immediately — a forced set-password
 * interstitial on the very next request would defeat that, and the first-login
 * prompt is optional now anyway (see `skipPasswordChange`). `passwordIsSchoolId`
 * records that the live password is once again the School ID, which is what
 * lets the console show it.
 */
export async function resetSchoolHeadPasswordToDefault(
  formData: FormData
): Promise<ActionResult<{ password: string }>> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = schoolIdInput.safeParse({ schoolId: formData.get("schoolId") });
  if (!parsed.success) return { ok: false, error: "Invalid school" };

  const rate = await checkRateLimit(`reset:sh:${admin.id}`, RESET_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await prisma.school.findFirst({
    where: { id: parsed.data.schoolId, deletedAt: null },
    select: { id: true, schoolIdCode: true },
  });
  if (!school) return { ok: false, error: "School not found" };

  const head = await findSchoolHead(school.id);
  if (!head) return { ok: false, error: "School Head account not found" };

  const password = defaultSchoolHeadPassword(school.schoolIdCode);
  const supabaseAdmin = createSupabaseAdminClient();
  const { error } = await supabaseAdmin.auth.admin.updateUserById(head.authId, {
    password,
    app_metadata: { role: "SCHOOL_HEAD", schoolId: school.id },
  });
  if (error) return { ok: false, error: "Failed to reset password" };

  await prisma.user.update({
    where: { id: head.id },
    data: {
      passwordIsSchoolId: true,
      mustChangePassword: false,
      isActive: true,
      // Whatever the head had chosen no longer opens the account, so the sealed
      // copy of it is deleted rather than left to be revealed later.
      passwordVaultCipher: null,
      passwordVaultSetAt: null,
    },
  });

  await writeAudit({
    userId: admin.id,
    schoolId: school.id,
    action: AUDIT_ACTIONS.SCHOOL_HEAD_PASSWORD_RESET_DEFAULT,
    resource: "User",
    resourceId: head.id,
    metadata: { schoolId: school.id },
  });

  revalidatePath("/admin/school-accounts");
  revalidateSchoolsList();
  // The School ID is not a secret — it is printed on the schools table and on
  // this console's own row — so returning it here reveals nothing new.
  return { ok: true, data: { password } };
}

/**
 * Sign the Super Admin into a School Head's session without changing its
 * password.
 *
 * Mechanism: `admin.generateLink` mints a magic-link token for the target
 * account (it generates only — Supabase sends no email, which matters because
 * School Head addresses are synthetic and undeliverable), and `verifyOtp`
 * redeems it on the SSR client so the session cookies land on this response.
 *
 * The admin's own session is replaced by that, so a signed ticket recording who
 * they were is written first — see `@/lib/auth/impersonation` for why it is
 * signed. `endImpersonation` redeems the ticket the same way, in reverse.
 */
export async function impersonateSchoolHead(formData: FormData): Promise<ActionResult> {
  const admin = await requireUser("SUPER_ADMIN");

  const parsed = schoolIdInput.safeParse({ schoolId: formData.get("schoolId") });
  if (!parsed.success) return { ok: false, error: "Invalid school" };

  const rate = await checkRateLimit(`impersonate:${admin.id}`, IMPERSONATE_RATE);
  if (!rate.ok) return { ok: false, error: "Too many attempts. Please try again later." };

  const school = await prisma.school.findFirst({
    where: { id: parsed.data.schoolId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!school) return { ok: false, error: "School not found" };

  const head = await findSchoolHead(school.id);
  if (!head) return { ok: false, error: "School Head account not found" };

  // Written before the session swap: after `verifyOtp` the request no longer
  // carries anything identifying the admin, so there would be nothing left to
  // record.
  await setImpersonationCookie({
    adminAuthId: admin.authId,
    adminUserId: admin.id,
    targetUserId: head.id,
  });

  const switched = await switchSessionTo(head.email);
  if (!switched.ok) {
    await clearImpersonationCookie();
    return switched;
  }

  await writeAudit({
    userId: admin.id,
    schoolId: school.id,
    action: AUDIT_ACTIONS.IMPERSONATION_START,
    resource: "User",
    resourceId: head.id,
    metadata: { schoolId: school.id, schoolName: school.name },
  });

  redirect("/school-head");
}

/**
 * Restore the Super Admin's own session and drop the ticket.
 *
 * Callable from any impersonated page. The ticket is the sole authority for who
 * gets restored, which is exactly why it is signed: without the signature this
 * action would sign the caller in as whichever admin they named.
 */
export async function endImpersonation(): Promise<ActionResult> {
  const ticket = await readImpersonationTicket();
  if (!ticket) return { ok: false, error: "Not impersonating" };

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

  const switched = await switchSessionTo(adminUser.email);
  if (!switched.ok) return switched;

  await clearImpersonationCookie();

  await writeAudit({
    userId: adminUser.id,
    action: AUDIT_ACTIONS.IMPERSONATION_END,
    resource: "User",
    resourceId: ticket.targetUserId,
  });

  redirect("/admin/school-accounts");
}

/**
 * Replace the current request's session cookies with a session for `email`.
 *
 * SUPER_ADMIN-gated by every caller above — this helper performs no
 * authorization of its own and must never be exported.
 */
async function switchSessionTo(email: string): Promise<ActionResult> {
  const supabaseAdmin = createSupabaseAdminClient();

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    console.error("[impersonation] generateLink failed:", error);
    return { ok: false, error: "Could not start that session. Please try again." };
  }

  const supabase = await createSupabaseServerClient();
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
