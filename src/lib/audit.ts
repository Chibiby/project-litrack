import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Audit logging helper.
 *
 * NEVER put passwords, tokens, credentials, invite secrets, or other secrets
 * in `metadata`. Log resource IDs and non-sensitive context only.
 */

export const AUDIT_ACTIONS = {
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_DENIED: "LOGIN_DENIED",
  LOGOUT: "LOGOUT",
  PASSWORD_CHANGE: "PASSWORD_CHANGE",
  PASSWORD_RESET_REQUEST: "PASSWORD_RESET_REQUEST",
  SCHOOL_CREATE: "SCHOOL_CREATE",
  SCHOOL_UPDATE: "SCHOOL_UPDATE",
  SCHOOL_DELETE: "SCHOOL_DELETE",
  SCHOOL_SET_ACTIVE: "SCHOOL_SET_ACTIVE",
  SCHOOL_HEAD_CREDENTIAL_REGENERATED: "SCHOOL_HEAD_CREDENTIAL_REGENERATED",
  SCHOOL_HEAD_PROFILE_SAVE: "SCHOOL_HEAD_PROFILE_SAVE",
  GRADE_LEVEL_CREATE: "GRADE_LEVEL_CREATE",
  SCHOOL_YEAR_CREATE: "SCHOOL_YEAR_CREATE",
  SCHOOL_YEAR_SET_ACTIVE: "SCHOOL_YEAR_SET_ACTIVE",
  SECTION_CREATE: "SECTION_CREATE",
  SECTION_UPDATE: "SECTION_UPDATE",
  SECTION_DELETE: "SECTION_DELETE",
  ANNOUNCEMENT_CREATE: "ANNOUNCEMENT_CREATE",
  ANNOUNCEMENT_UPDATE: "ANNOUNCEMENT_UPDATE",
  ANNOUNCEMENT_DELETE: "ANNOUNCEMENT_DELETE",
  TEACHER_INVITE: "TEACHER_INVITE",
  TEACHER_INVITE_RESEND: "TEACHER_INVITE_RESEND",
  TEACHER_INVITE_REVOKE: "TEACHER_INVITE_REVOKE",
  TEACHER_ASSIGN_GRADE: "TEACHER_ASSIGN_GRADE",
  TEACHER_INVITE_ACCEPT: "TEACHER_INVITE_ACCEPT",
  TEACHER_PROFILE_SAVE: "TEACHER_PROFILE_SAVE",
  LEARNER_CREATE: "LEARNER_CREATE",
  LEARNER_UPDATE: "LEARNER_UPDATE",
  LEARNER_ARCHIVE: "LEARNER_ARCHIVE",
  LEARNER_RESTORE: "LEARNER_RESTORE",
  LEARNER_TRANSFER: "LEARNER_TRANSFER",
  LEARNER_TRANSFER_CROSS_SCHOOL: "LEARNER_TRANSFER_CROSS_SCHOOL",
  LEARNER_TOGGLE_ARAL: "LEARNER_TOGGLE_ARAL",
  ARAL_PROFILE_SAVE: "ARAL_PROFILE_SAVE",
  ATTENDANCE_MARK: "ATTENDANCE_MARK",
  READING_LEVEL_RECORD: "READING_LEVEL_RECORD",
  IMPORT_LEARNERS: "IMPORT_LEARNERS",
  EXPORT_LEARNERS_EXCEL: "EXPORT_LEARNERS_EXCEL",
  EXPORT_PRINTABLE_REPORT: "EXPORT_PRINTABLE_REPORT",
  ADMIN_PROFILE_UPDATE: "ADMIN_PROFILE_UPDATE",
  ADMIN_SCHOOL_VIEW: "ADMIN_SCHOOL_VIEW",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export type AuditEntry = {
  userId?: string | null;
  schoolId?: string | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Insert an AuditLog row. Failures are logged and never thrown.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        schoolId: entry.schoolId ?? null,
        action: entry.action,
        resource: entry.resource,
        resourceId: entry.resourceId ?? null,
        metadata: (entry.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
      },
    });
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}
