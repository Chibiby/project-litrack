import "server-only";
import { after } from "next/server";
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
  EMAIL_CHANGE: "EMAIL_CHANGE",

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
  TEACHER_ASSIGN_SECTIONS: "TEACHER_ASSIGN_SECTIONS",
  TEACHER_SET_ADVISORY_SECTION: "TEACHER_SET_ADVISORY_SECTION",
  TEACHER_INVITE_ACCEPT: "TEACHER_INVITE_ACCEPT",
  TEACHER_APPROVE: "TEACHER_APPROVE",
  TEACHER_REJECT: "TEACHER_REJECT",
  TEACHER_REJECTION_CLEARED: "TEACHER_REJECTION_CLEARED",
  TEACHER_DEACTIVATE: "TEACHER_DEACTIVATE",
  TEACHER_REACTIVATE: "TEACHER_REACTIVATE",
  TEACHER_REMOVE: "TEACHER_REMOVE",
  TEACHER_REGISTER: "TEACHER_REGISTER",
  TEACHER_PROFILE_SAVE: "TEACHER_PROFILE_SAVE",
  LEARNER_CREATE: "LEARNER_CREATE",
  LEARNER_UPDATE: "LEARNER_UPDATE",
  LEARNER_ARCHIVE: "LEARNER_ARCHIVE",
  LEARNER_RESTORE: "LEARNER_RESTORE",
  /** Soft delete — sets Learner.deletedAt. Attendance/reading history is kept. */
  LEARNER_DELETE: "LEARNER_DELETE",
  LEARNER_TRANSFER: "LEARNER_TRANSFER",
  LEARNER_TRANSFER_CROSS_SCHOOL: "LEARNER_TRANSFER_CROSS_SCHOOL",
  LEARNER_TOGGLE_ARAL: "LEARNER_TOGGLE_ARAL",
  LEARNER_ENROLL_ARAL: "LEARNER_ENROLL_ARAL",
  LEARNER_SET_ARAL_TEACHER: "LEARNER_SET_ARAL_TEACHER",
  ARAL_PROFILE_SAVE: "ARAL_PROFILE_SAVE",
  ATTENDANCE_MARK: "ATTENDANCE_MARK",
  /**
   * Retired with the daily grid it served. Kept because rows already written
   * under this action stay in `AuditLog`, and the viewers render the stored
   * string — dropping the key would leave history without a name.
   */
  ATTENDANCE_BULK_MARK: "ATTENDANCE_BULK_MARK",
  /** One week of a grade's ARAL attendance saved from the weekly grid. */
  ATTENDANCE_WEEK_SAVE: "ATTENDANCE_WEEK_SAVE",
  ATTENDANCE_DAY_HOLIDAY: "ATTENDANCE_DAY_HOLIDAY",
  READING_LEVEL_RECORD: "READING_LEVEL_RECORD",
  READING_LEVEL_BULK_RECORD: "READING_LEVEL_BULK_RECORD",
  /**
   * One term of one advisory section's grade sheet saved. Metadata carries the
   * placement, the term, saved/cleared counts and learner ids — never the score
   * values, which are learner PII.
   */
  TERM_GRADES_BULK_SAVE: "TERM_GRADES_BULK_SAVE",
  /** A term grade sheet downloaded as Excel. Counts only, no scores. */
  TERM_GRADES_EXPORT: "TERM_GRADES_EXPORT",
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
 *
 * The insert is dispatched through `after()`, so the caller no longer pays a
 * database round trip on the response path — nothing reads an audit row
 * synchronously. `writeAudit` itself is still *called* synchronously by its
 * caller, so every `await writeAudit(...)` call site keeps its existing shape
 * and its ordering relative to the rest of the action; only the write moves.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  await deferOrRun(() => insertOneRow(entry));
}

/**
 * Insert N AuditLog rows in a single statement.
 *
 * Use this instead of `await writeAudit(...)` in a loop. Deferring N per-row
 * inserts individually would be worse than the serial loop it replaces:
 * `after()`'s callback queue is built with no options, so its concurrency is
 * `Infinity` and all N writes fire at once against a pool whose
 * `connection_limit` is floored at 3 (`src/lib/db-url.ts`) — the overflow times
 * out as P2024 after the response has already been sent, and the rows are lost.
 * One `createMany` per call site keeps the fan-out at one and turns N round
 * trips into one.
 */
export async function writeAuditMany(entries: AuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  await deferOrRun(() => insertManyRows(entries));
}

/** AuditLog has no relations, so one row shape serves `create` and `createMany`. */
function toRowData(entry: AuditEntry): Prisma.AuditLogCreateManyInput {
  return {
    userId: entry.userId ?? null,
    schoolId: entry.schoolId ?? null,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    metadata: (entry.metadata as Prisma.InputJsonValue | undefined) ?? undefined,
  };
}

async function insertOneRow(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({ data: toRowData(entry) });
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}

async function insertManyRows(entries: AuditEntry[]): Promise<void> {
  try {
    await prisma.auditLog.createMany({ data: entries.map(toRowData) });
  } catch (err) {
    console.error("[audit] write failed:", err);
  }
}

/**
 * Hand `write` to `after()` so it runs once the response has been flushed, and
 * run it inline when `after()` refuses.
 *
 * `after()` throws synchronously in three cases, all of them *before* the task
 * is queued: E468 (called outside a request scope — scripts, unit tests), E91
 * (`waitUntil` unavailable on the host, thrown from `addCallback` rather than
 * from the entry point) and E50 (task is neither a promise nor a function,
 * which we avoid by construction — we always pass a function). Because nothing
 * is queued in any of the three, the fallback cannot double-write.
 *
 * The fallback *runs* the write rather than dropping it: AuditLog is a PH Data
 * Privacy Act artifact, and permanently losing a row is strictly worse than the
 * round trip the deferral saves. `write` owns its own try/catch and logs
 * `[audit] write failed:`, so this never throws on either path and Next's
 * `onTaskError` never sees an audit failure.
 */
function deferOrRun(write: () => Promise<void>): Promise<void> {
  try {
    after(write);
  } catch {
    return write();
  }
  return Promise.resolve();
}
