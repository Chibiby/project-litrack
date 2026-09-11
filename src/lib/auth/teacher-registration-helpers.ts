import type { User } from "@prisma/client";
import { formatMessage, type ErrorCode } from "@/lib/errors/codes";

/** @deprecated Prefer `formatMessage("AUTH_REGISTRATION_DECLINED")`. */
export const DECLINED_REGISTRATION_MESSAGE = formatMessage("AUTH_REGISTRATION_DECLINED");

/** @deprecated Prefer `formatMessage("AUTH_ACCOUNT_DEACTIVATED")`. */
export const DEACTIVATED_TEACHER_MESSAGE = formatMessage("AUTH_ACCOUNT_DEACTIVATED");

/** PENDING teacher at this school — safe to treat register as success (idempotent). */
export function isPendingTeacherAtSchool(
  user: Pick<User, "role" | "schoolId" | "approvalStatus" | "deletedAt">,
  schoolId: string
): boolean {
  return (
    !user.deletedAt &&
    user.role === "TEACHER" &&
    user.schoolId === schoolId &&
    user.approvalStatus === "PENDING"
  );
}

/** Approved teacher who was deactivated (not pending / rejected). */
export function isDeactivatedTeacher(
  user: Pick<User, "role" | "approvalStatus" | "isActive" | "deletedAt">
): boolean {
  return (
    user.role === "TEACHER" &&
    !user.deletedAt &&
    user.approvalStatus === "APPROVED" &&
    !user.isActive
  );
}

/**
 * Why a registration cannot proceed for an address that already has an account.
 *
 * An account at ANOTHER school is deliberately the vaguest answer: naming it
 * would tell a stranger where a colleague works.
 */
export function registerConflictCode(
  user: Pick<User, "role" | "schoolId" | "approvalStatus" | "isActive">,
  schoolId: string
): ErrorCode {
  if (user.role === "TEACHER" && user.schoolId === schoolId) {
    if (user.approvalStatus === "PENDING") return "AUTH_TEACHER_PENDING";
    if (user.approvalStatus === "REJECTED") return "AUTH_REGISTRATION_DECLINED";
    if (user.approvalStatus === "APPROVED" && !user.isActive) return "AUTH_ACCOUNT_DEACTIVATED";
    if (user.approvalStatus === "APPROVED" || user.isActive) {
      return "AUTH_ACCOUNT_EXISTS_SIGN_IN";
    }
  }
  return "AUTH_EMAIL_IN_USE";
}

/** Kept for callers that only want the sentence. */
export function registerConflictError(
  user: Pick<User, "role" | "schoolId" | "approvalStatus" | "isActive">,
  schoolId: string
): string {
  return formatMessage(registerConflictCode(user, schoolId));
}
