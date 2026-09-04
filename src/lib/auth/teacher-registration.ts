import "server-only";
import { prisma } from "@/lib/prisma";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { writeAudit, AUDIT_ACTIONS } from "@/lib/audit";
import {
  revalidateAdminDashboard,
  revalidateSchoolDashboard,
} from "@/lib/cache/revalidate";
import type { TeacherApprovalStatus, User } from "@prisma/client";
import {
  DECLINED_REGISTRATION_MESSAGE,
  DEACTIVATED_TEACHER_MESSAGE,
  isDeactivatedTeacher,
  isPendingTeacherAtSchool,
  registerConflictError,
} from "@/lib/auth/teacher-registration-helpers";

export type TeacherAuthIntent = "login" | "register";

export {
  DECLINED_REGISTRATION_MESSAGE,
  DEACTIVATED_TEACHER_MESSAGE,
  isDeactivatedTeacher,
  isPendingTeacherAtSchool,
  registerConflictError,
} from "@/lib/auth/teacher-registration-helpers";

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

function prismaErrorCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code: unknown }).code);
  }
  return "";
}

function redirectOutcome(user: User): CompleteTeacherAuthResult {
  if (user.approvalStatus === "REJECTED") {
    return { ok: false, error: DECLINED_REGISTRATION_MESSAGE, signOut: true };
  }
  if (isDeactivatedTeacher(user)) {
    return { ok: false, error: DEACTIVATED_TEACHER_MESSAGE, signOut: true };
  }
  if (user.approvalStatus === "PENDING") {
    return { ok: true, outcome: "pending" };
  }
  if (user.approvalStatus === "APPROVED" || user.isActive) {
    return { ok: true, outcome: "approved" };
  }
  return { ok: true, outcome: "pending" };
}

/**
 * Best-effort JWT role stamp. Never throws: the Prisma user row is already the
 * authoritative record, and `createSupabaseAdminClient()` throws outright when
 * SUPABASE_SERVICE_ROLE_KEY is missing or invalid — letting that escape would
 * fail a registration that already succeeded.
 */
async function setTeacherAppMetadata(authId: string, schoolId: string): Promise<void> {
  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin.auth.admin.updateUserById(authId, {
      app_metadata: { role: "TEACHER", schoolId },
    });
    if (error) {
      console.error("[teacher-registration] app_metadata update failed:", error.message);
    }
  } catch (err) {
    console.error("[teacher-registration] app_metadata update threw:", err);
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
 * Once the Supabase session exists: create/link the Prisma TEACHER user and
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

    let created: User | null = null;
    try {
      created = await prisma.user.create({
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
    } catch (err) {
      // Race / retry: peer may have created the same email (P2002) or create
      // failed after a peer succeeded. Always re-read before failing closed.
      const code = prismaErrorCode(err);
      if (code !== "P2002") {
        console.error("[teacher-registration] create failed:", err);
      }
      existing = await prisma.user.findUnique({ where: { email } });
      if (!existing) {
        return { ok: false, error: "Registration failed. Please try again.", signOut: true };
      }
      // Fall through to register rules with `existing` (PENDING → success).
    }

    if (created) {
      await setTeacherAppMetadata(authId, schoolId);

      await writeAudit({
        userId: created.id,
        schoolId,
        action: AUDIT_ACTIONS.TEACHER_REGISTER,
        resource: "User",
        resourceId: created.id,
        metadata: { schoolId, email, method: "self_register" },
      });

      // Pending-approval counts on school + admin dashboards. Never let cache
      // revalidation turn a successful create into a client-facing failure.
      try {
        revalidateSchoolDashboard(schoolId);
        revalidateAdminDashboard();
      } catch (err) {
        console.error("[teacher-registration] revalidate after create failed:", err);
      }

      return { ok: true, outcome: "pending" };
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
    // Race after create or register with an existing email.
    // PENDING at this school → fall through to login rules (idempotent).
    // Otherwise same conflict messages as registerTeacher.
    if (!isPendingTeacherAtSchool(existing, schoolId)) {
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
