import type { User } from "@prisma/client";

export const DECLINED_REGISTRATION_MESSAGE =
  "Your registration was declined. Contact your School Head.";

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

export function registerConflictError(
  user: Pick<User, "role" | "schoolId" | "approvalStatus" | "isActive">,
  schoolId: string
): string {
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
