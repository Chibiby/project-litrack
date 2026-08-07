import "server-only";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  revalidateAdminDashboard,
  revalidateSchoolDashboard,
} from "@/lib/cache/revalidate";
import type { TeacherApprovalStatus, User } from "@prisma/client";

export type TeacherAuthIntent = "login" | "register";

export const DECLINED_REGISTRATION_MESSAGE =
  "Your registration was declined. Contact your School Head.";

export const TEACHER_OAUTH_CTX_COOKIE = "teacher_oauth_ctx";

export type TeacherOAuthCtx = {
  schoolId: string;
  intent: TeacherAuthIntent;
};

export type TeacherNameParts = {
  firstName: string;
  middleName?: string;
  lastName: string;
};

export type CompleteTeacherAuthParams = {
  authId: string;
  email: string;
  schoolId: string;
  intent: TeacherAuthIntent;
  /** Required for register when creating a new user; ignored when falling through to login. */
  names?: TeacherNameParts;
};

export type CompleteTeacherAuthResult =
  | { ok: true; outcome: "pending" | "approved" }
  | { ok: false; error: string; signOut: boolean };

function buildFullName(firstName: string, middleName: string | undefined, lastName: string): string {
  return [firstName, middleName, lastName].filter(Boolean).join(" ");
}

export function parseNamesFromUserMetadata(
  metadata: Record<string, unknown> | undefined,
  email: string
): TeacherNameParts {
  const given =
    typeof metadata?.given_name === "string" ? metadata.given_name.trim() : "";
  const family =
    typeof metadata?.family_name === "string" ? metadata.family_name.trim() : "";
  if (given || family) {
    return {
      firstName: given || family,
      lastName: family || given,
    };
  }

  const full =
    (typeof metadata?.full_name === "string" && metadata.full_name.trim()) ||
    (typeof metadata?.name === "string" && metadata.name.trim()) ||
    "";
  if (full) {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return { firstName: parts[0], lastName: parts[0] };
    }
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(" "),
    };
  }

  const local = email.split("@")[0]?.trim() || "Teacher";
  return { firstName: local, lastName: local };
}

export function registerConflictError(user: User, schoolId: string): string {
  if (user.role === "TEACHER" && user.schoolId === schoolId) {
    if (user.approvalStatus === "PENDING") {
      return "Your request is pending School Head approval.";
    }
    if (user.approvalStatus === "REJECTED") {
      return DECLINED_REGISTRATION_MESSAGE;
    }
    if (user.approvalStatus === "APPROVED" || user.isActive) {
      return "Account already exists. Use Login instead.";
    }
  }
  return "This email is already in use.";
}

function isPendingLike(user: User): boolean {
  return (
    user.approvalStatus === "PENDING" ||
    (!user.isActive && user.approvalStatus !== "REJECTED")
  );
}

function redirectOutcome(user: User): CompleteTeacherAuthResult {
  if (user.approvalStatus === "REJECTED") {
    return { ok: false, error: DECLINED_REGISTRATION_MESSAGE, signOut: true };
  }
  if (isPendingLike(user)) {
    return { ok: true, outcome: "pending" };
  }
  if (user.approvalStatus === "APPROVED" || user.isActive) {
    return { ok: true, outcome: "approved" };
  }
  return { ok: true, outcome: "pending" };
}

async function setTeacherAppMetadata(authId: string, schoolId: string): Promise<void> {
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.updateUserById(authId, {
    app_metadata: { role: "TEACHER", schoolId },
  });
  if (error) {
    console.error("[teacher-registration] app_metadata update failed:", error.message);
  }
}

async function linkAuthIdIfNeeded(user: User, authId: string): Promise<User> {
  if (user.authId === authId) return user;
  return prisma.user.update({
    where: { id: user.id },
    data: { authId },
  });
}

/**
 * After OTP verify or OAuth callback: create/link the Prisma TEACHER user and
 * decide pending vs approved vs rejected. Callers handle redirects / sign-out.
 */
export async function completeTeacherAuthAfterVerify(
  params: CompleteTeacherAuthParams
): Promise<CompleteTeacherAuthResult> {
  const email = params.email.toLowerCase().trim();
  const { authId, schoolId, intent } = params;

  let existing = await prisma.user.findUnique({ where: { email } });

  if (intent === "register" && !existing) {
    const names = params.names;
    if (!names?.firstName?.trim() || !names?.lastName?.trim()) {
      return { ok: false, error: "First and last name are required.", signOut: true };
    }

    const firstName = names.firstName.trim();
    const middleName = names.middleName?.trim() || undefined;
    const lastName = names.lastName.trim();
    const fullName = buildFullName(firstName, middleName, lastName);

    try {
      const created = await prisma.user.create({
        data: {
          authId,
          email,
          role: "TEACHER",
          schoolId,
          firstName,
          middleName: middleName ?? null,
          lastName,
          fullName,
          isActive: false,
          approvalStatus: "PENDING" satisfies TeacherApprovalStatus,
          mustChangePassword: false,
          profileCompleted: false,
        },
      });

      await setTeacherAppMetadata(authId, schoolId);

      await writeAudit({
        userId: created.id,
        schoolId,
        action: AUDIT_ACTIONS.TEACHER_REGISTER,
        resource: "User",
        resourceId: created.id,
        metadata: { schoolId, email, method: "self_register" },
      });

      // Pending-approval counts on school + admin dashboards.
      revalidateSchoolDashboard(schoolId);
      revalidateAdminDashboard();

      return { ok: true, outcome: "pending" };
    } catch (err) {
      // Race: another request created the same email — fall through to login rules.
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code !== "P2002") {
        console.error("[teacher-registration] create failed:", err);
        return { ok: false, error: "Registration failed. Please try again.", signOut: true };
      }
      existing = await prisma.user.findUnique({ where: { email } });
    }
  }

  if (!existing) {
    return {
      ok: false,
      error: "No teacher account found for this school. Create an account first.",
      signOut: true,
    };
  }

  if (existing.deletedAt) {
    return {
      ok: false,
      error: "No teacher account found for this school. Create an account first.",
      signOut: true,
    };
  }

  if (intent === "register") {
    // Race after create (P2002) or OAuth/register with an existing email.
    // PENDING at this school → fall through to login rules (idempotent).
    // Otherwise same conflict messages as requestTeacherOtp.
    const pendingHere =
      existing.role === "TEACHER" &&
      existing.schoolId === schoolId &&
      existing.approvalStatus === "PENDING";
    if (!pendingHere) {
      return {
        ok: false,
        error: registerConflictError(existing, schoolId),
        signOut: true,
      };
    }
  } else {
    if (existing.role !== "TEACHER" || existing.schoolId !== schoolId) {
      return {
        ok: false,
        error: "No teacher account found for this school. Create an account first.",
        signOut: true,
      };
    }
    if (existing.approvalStatus === "REJECTED") {
      return { ok: false, error: DECLINED_REGISTRATION_MESSAGE, signOut: true };
    }
  }

  const linked = await linkAuthIdIfNeeded(existing, authId);
  await setTeacherAppMetadata(authId, schoolId);

  await writeAudit({
    userId: linked.id,
    schoolId,
    action: AUDIT_ACTIONS.LOGIN_SUCCESS,
    resource: "User",
    resourceId: linked.id,
    metadata: { role: "TEACHER", schoolId, method: intent },
  });

  return redirectOutcome(linked);
}
