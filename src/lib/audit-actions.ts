/**
 * Audit action name constants.
 *
 * Deliberately side-effect-free — no `server-only`, no Next, no Prisma, no
 * `@/lib/prisma` import — so it can be imported from both the app (via
 * `src/lib/audit.ts`, which re-exports it) and standalone CLI scripts under
 * `scripts/**` that run outside of Next's module resolution (`tsx`, not
 * webpack/turbopack) and therefore cannot resolve `server-only`.
 *
 * This is the single source of truth for audit action names. Add new actions
 * here, not in `audit.ts`.
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
  /**
   * Super Admin put a School Head's password back to the school's School ID so
   * they could sign in and diagnose the account. The School ID is already on
   * the School row, so this logs ids only — same rule as every other action.
   */
  SCHOOL_HEAD_PASSWORD_RESET_DEFAULT: "SCHOOL_HEAD_PASSWORD_RESET_DEFAULT",
  /**
   * Super Admin revealed a School Head's own password in the accounts console.
   *
   * This is the one action in LITRACK where an admin reads a credential a
   * person chose for themselves, so it is logged on every single reveal — not
   * deduped, not batched. The row records who looked, at whose account, and
   * when; never the password, which is the whole point of logging it.
   */
  SCHOOL_HEAD_PASSWORD_VIEWED: "SCHOOL_HEAD_PASSWORD_VIEWED",
  /**
   * Super Admin issued a teacher a new one-time credential from
   * `/admin/accounts`.
   *
   * Deliberately NOT folded into `SCHOOL_HEAD_PASSWORD_RESET_DEFAULT`: that
   * string means "the live password is once again the School ID" and is
   * replayed by the `passwordIsSchoolId` backfill. A teacher reset means the
   * opposite — a random credential nobody can read back — and one shared string
   * would leave the log unable to say which happened.
   *
   * Metadata is the school id and where it was done from. NEVER the credential
   * itself, the teacher's email, or their name: the credential is shown once in
   * the admin's browser and is never persisted anywhere.
   */
  TEACHER_PASSWORD_RESET: "TEACHER_PASSWORD_RESET",
  /**
   * Super Admin took over another account's session without touching its
   * password. Any role except SUPER_ADMIN — a School Head or a teacher, the
   * latter since the accounts console replaced the school-accounts one. Both
   * ends are logged so the audit trail can always answer "was this the account
   * holder or the admin?" for any write in between; START carries `targetRole`
   * so that question can be answered without a join.
   */
  IMPERSONATION_START: "IMPERSONATION_START",
  IMPERSONATION_END: "IMPERSONATION_END",
  SCHOOL_HEAD_PROFILE_SAVE: "SCHOOL_HEAD_PROFILE_SAVE",
  GRADE_LEVEL_CREATE: "GRADE_LEVEL_CREATE",
  /**
   * A grade deactivated because it was set up by mistake. Only ever an EMPTY
   * grade — `archiveGradeLevel` refuses while any learner remains — so this row
   * can never mark the moment a class of learners was hidden.
   */
  GRADE_LEVEL_ARCHIVE: "GRADE_LEVEL_ARCHIVE",
  /**
   * The reverse, bringing back the sections archived in the same act. Advisers
   * are NOT restored with them: archiving frees an adviser, and re-attaching
   * someone to a section they may have moved on from is not this action's call.
   */
  GRADE_LEVEL_RESTORE: "GRADE_LEVEL_RESTORE",
  SCHOOL_YEAR_CREATE: "SCHOOL_YEAR_CREATE",
  SCHOOL_YEAR_SET_ACTIVE: "SCHOOL_YEAR_SET_ACTIVE",
  /**
   * A head corrected a year's label or date range. The metadata carries both the
   * old and the new values because the row is overwritten in place: without the
   * "from" side, a report that looks wrong six months later cannot be traced
   * back to the day someone moved the range.
   */
  SCHOOL_YEAR_UPDATE: "SCHOOL_YEAR_UPDATE",
  /** Only ever an empty year — see `deleteSchoolYear`. */
  SCHOOL_YEAR_DELETE: "SCHOOL_YEAR_DELETE",
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
  TEACHER_ADVISORY_SETTING_CHANGE: "TEACHER_ADVISORY_SETTING_CHANGE",
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
  /** A Reports Hub report generated. Row counts and filter ids only. */
  REPORT_GENERATE: "REPORT_GENERATE",
  /** A Reports Hub history row removed. The file was never stored. */
  REPORT_DELETE: "REPORT_DELETE",
  /**
   * A question answered by the model backend rather than the offline index.
   *
   * Token counts and the number of help topics quoted — never the question and
   * never the answer. Both can name a learner, and an audit log is the last
   * place learner names should accumulate. This row exists to answer "how much
   * is this costing and how often is it used", not "what did they ask".
   */
  ASSISTANT_AI_QUERY: "ASSISTANT_AI_QUERY",
  /**
   * A chat message was posted. The channel id, its kind and a mention count —
   * never the body, which is a person's own words to a colleague.
   */
  CHAT_MESSAGE_SEND: "CHAT_MESSAGE_SEND",
  /** A Super Admin opened a school's staff-room channel. Deduped like ADMIN_SCHOOL_VIEW. */
  CHAT_ADMIN_VIEW: "CHAT_ADMIN_VIEW",
  /** A support ticket raised from the assistant. Ids and category only, never the body. */
  SUPPORT_TICKET_SUBMIT: "SUPPORT_TICKET_SUBMIT",
  SUPPORT_TICKET_RESOLVE: "SUPPORT_TICKET_RESOLVE",
  SUPPORT_TICKET_DECLINE: "SUPPORT_TICKET_DECLINE",
  /**
   * Temporary write access into a closed editing window. Metadata carries the
   * scope, the target period and the expiry: the facts an auditor needs to say
   * who could write what, and when it closed again.
   */
  UNLOCK_GRANT_ISSUE: "UNLOCK_GRANT_ISSUE",
  UNLOCK_GRANT_REVOKE: "UNLOCK_GRANT_REVOKE",
  /** A save that only succeeded because an unlock grant was in force. */
  UNLOCK_GRANT_USED: "UNLOCK_GRANT_USED",
  /**
   * The same three facts for a `SchoolUnlockGrant` — one grant that reopens a
   * window for every teacher in a school at once.
   *
   * Kept as their own actions rather than folded into the three above with a
   * flag, because the question an auditor asks is different: a personal grant
   * names one person who could write, and a school grant names a school. The
   * metadata follows that split — ids, the scope, the target period, the expiry
   * and a recipient COUNT. Never a teacher's name, never an email, never
   * anything about a learner.
   */
  UNLOCK_SCHOOL_GRANT_ISSUE: "UNLOCK_SCHOOL_GRANT_ISSUE",
  UNLOCK_SCHOOL_GRANT_REVOKE: "UNLOCK_SCHOOL_GRANT_REVOKE",
  UNLOCK_SCHOOL_GRANT_USED: "UNLOCK_SCHOOL_GRANT_USED",
  ADMIN_PROFILE_UPDATE: "ADMIN_PROFILE_UPDATE",
  ADMIN_SCHOOL_VIEW: "ADMIN_SCHOOL_VIEW",
  /**
   * A Super Admin login was retired (soft-deleted, Supabase auth user removed).
   * `scripts/retire-super-admin.ts` is the only writer today, run by a human,
   * not a request — metadata carries ids only, the same rule as every other
   * action here.
   */
  SUPER_ADMIN_RETIRE: "SUPER_ADMIN_RETIRE",

  /**
   * Global Archive (`/admin/archive`) restore and permanent delete.
   *
   * Deliberately NOT reusing `LEARNER_RESTORE` (means "cleared `archivedAt`")
   * or `TEACHER_REACTIVATE` (means "set `isActive`") — these are three
   * different state changes, and if two of them shared one string the log
   * would stop being able to answer which one actually happened.
   */
  ARCHIVE_LEARNER_RESTORE: "ARCHIVE_LEARNER_RESTORE",
  ARCHIVE_LEARNER_PURGE: "ARCHIVE_LEARNER_PURGE",
  ARCHIVE_TEACHER_RESTORE: "ARCHIVE_TEACHER_RESTORE",
  ARCHIVE_TEACHER_PURGE: "ARCHIVE_TEACHER_PURGE",

  /**
   * Database console. These are the highest-consequence actions in the app —
   * a restore or a reset rewrites every tenant at once — so each one logs the
   * row counts it moved and the backup it came from. Never the data itself: a
   * snapshot is the entire learner roster, and audit metadata is read back in
   * two UIs.
   *
   * `DB_BACKUP_CREATE` covers both the scheduled job and the manual button;
   * the `trigger` field in metadata separates them.
   */
  DB_BACKUP_CREATE: "DB_BACKUP_CREATE",
  DB_BACKUP_DELETE: "DB_BACKUP_DELETE",
  DB_BACKUP_DOWNLOAD: "DB_BACKUP_DOWNLOAD",
  DB_RESTORE: "DB_RESTORE",
  DB_RESTORE_UPLOAD: "DB_RESTORE_UPLOAD",
  DB_ROLLBACK: "DB_ROLLBACK",
  DB_RESET_OPERATIONAL: "DB_RESET_OPERATIONAL",
  DB_RESET_SCHOOL_ACCOUNTS: "DB_RESET_SCHOOL_ACCOUNTS",
  DB_REMOVE_TEACHER_ACCOUNTS: "DB_REMOVE_TEACHER_ACCOUNTS",

  /**
   * The training/demo tenant. `DEMO_MODE_SET` records the visibility switch,
   * which is reversible and touches no rows. `DEMO_RESET` is the destructive
   * one — it hard-deletes the demo school — so it logs the per-model row counts
   * it removed, the same rule the database console follows.
   */
  DEMO_MODE_SET: "DEMO_MODE_SET",
  DEMO_PROVISION: "DEMO_PROVISION",
  DEMO_RESET: "DEMO_RESET",

  /**
   * Whether submission deadlines are being enforced at all
   * (`submissions.locking`). One row per flip, and the reason it is audited at
   * all: while this is off, a save past a deadline records no grant, so this is
   * the only thing that explains why the window was open.
   */
  SUBMISSION_LOCKING_SET: "SUBMISSION_LOCKING_SET",

  /**
   * The programme-wide "monthly reading level is open to everyone" switch
   * (`submissions.readingLevelUnlockAll`). Audited for the same reason as
   * `SUBMISSION_LOCKING_SET`: while it is on, a save into a closed month records
   * no grant, so this row is the only thing that explains why the window was
   * open.
   */
  READING_LEVEL_UNLOCK_ALL_SET: "READING_LEVEL_UNLOCK_ALL_SET",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
