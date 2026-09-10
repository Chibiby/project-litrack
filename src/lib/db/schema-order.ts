/**
 * The order every snapshot writes rows in, and the reverse of the order it
 * deletes them in.
 *
 * This list is the single thing restore correctness rests on. Prisma's foreign
 * keys are not DEFERRABLE, so a restore cannot simply insert everything and let
 * the database sort it out inside a transaction — each table must land after
 * every table it points at. Getting one pair backwards produces a foreign-key
 * violation mid-restore, which is loud and recoverable; getting a *deletion*
 * pair backwards is the dangerous direction, which is why deletes walk this
 * list backwards rather than using a second hand-written list that could drift.
 *
 * A test asserts this list covers every model Prisma knows about, so adding a
 * model to `schema.prisma` without placing it here fails the suite rather than
 * silently dropping that table from every backup taken afterwards.
 *
 * Two structural facts that are easy to get wrong and are load-bearing here:
 *
 *  - `School.createdById` and `AuditLog.userId` / `AuditLog.schoolId` look like
 *    foreign keys but are plain nullable columns with no `@relation`. They
 *    impose no ordering, which is the only reason `School` can be first and
 *    `AuditLog` can be last.
 *  - `User.advisorySectionId` USED to be a real foreign key to `Section`, which
 *    forced `User` after `Section`. Wave A of multi-advisory inverted the
 *    pointer — `Section.adviserId` now points at `User` — and dropped the old
 *    key in the same migration, because keeping both would make the two models
 *    a cycle that no single order can satisfy. `User` therefore comes FIRST
 *    now, and `advisorySectionId` is a plain column imposing no ordering, the
 *    same shape as the two above.
 */

/**
 * A Prisma `where` that narrows one operational model to a single school.
 *
 * Every operational model carries one, because "clear this school's data"
 * cannot lean on `ON DELETE CASCADE`: the cascade fires from a parent row the
 * same operation is deleting, so the per-table counts would come back wrong and
 * the result would depend on delete order rather than on the filter. Models
 * with their own `schoolId` column filter on it; the rest walk the relation
 * that owns them, which is why several of these are nested.
 */
export type SchoolScope = (schoolId: string) => Record<string, unknown>;

const bySchoolId: SchoolScope = (schoolId) => ({ schoolId });
const byLearner: SchoolScope = (schoolId) => ({ learner: { schoolId } });
const byChannel: SchoolScope = (schoolId) => ({ channel: { schoolId } });

/** Prisma model name → the client delegate key (camelCase). */
export type SnapshotModel = {
  /** Prisma model name as it appears in `schema.prisma` and the DMMF. */
  model: string;
  /** Key on the Prisma client, e.g. `prisma.schoolYear`. */
  delegate: string;
  /**
   * True when the table holds records of what happened rather than the
   * structure schools are made of. "Clear operational data" empties exactly
   * these and leaves the rest, so a school keeps its years, grades, sections
   * and people while losing its learners and their records.
   */
  operational: boolean;
  /**
   * How to narrow this table to one school. Required on every operational
   * model — a school-scoped clear refuses rather than guessing — and absent on
   * the structural ones, which a clear never touches.
   */
  schoolScope?: SchoolScope;
};

export const SNAPSHOT_MODELS: SnapshotModel[] = [
  // Structure: the tenant and the shape of a school year.
  { model: "School", delegate: "school", operational: false },
  // Global operator switches. No foreign key in either direction, so its
  // position is unconstrained — it sits here only because `School` first and
  // `AuditLog` last are asserted by the ordering test, and the switches are
  // conceptually part of the system's structure. Non-operational: "clear
  // operational data" must not quietly reset demo mode to its default.
  { model: "SystemSetting", delegate: "systemSetting", operational: false },
  { model: "SchoolYear", delegate: "schoolYear", operational: false },
  { model: "GradeLevel", delegate: "gradeLevel", operational: false },
  // Before Section — `Section.adviserId` points at User since Wave A of the
  // multi-advisory change, and the old `User.advisorySectionId` foreign key was
  // dropped in that same migration precisely so this pair has one valid order
  // again. See the note above.
  { model: "User", delegate: "user", operational: false },
  { model: "Section", delegate: "section", operational: false },
  { model: "SchoolHeadProfile", delegate: "schoolHeadProfile", operational: false },
  { model: "TeacherProfile", delegate: "teacherProfile", operational: false },
  { model: "TeacherSection", delegate: "teacherSection", operational: false },
  { model: "TeacherInvite", delegate: "teacherInvite", operational: false },

  // Operational: learners and everything recorded about them.
  { model: "Learner", delegate: "learner", operational: true, schoolScope: bySchoolId },
  { model: "Enrollment", delegate: "enrollment", operational: true, schoolScope: bySchoolId },
  { model: "AralProfile", delegate: "aralProfile", operational: true, schoolScope: byLearner },
  { model: "Attendance", delegate: "attendance", operational: true, schoolScope: byLearner },
  {
    model: "AttendanceDayMeta",
    delegate: "attendanceDayMeta",
    operational: true,
    schoolScope: (schoolId) => ({ gradeLevel: { schoolId } }),
  },
  { model: "ReadingLevelRecord", delegate: "readingLevelRecord", operational: true, schoolScope: byLearner },
  { model: "TermGrade", delegate: "termGrade", operational: true, schoolScope: byLearner },
  { model: "Announcement", delegate: "announcement", operational: true, schoolScope: bySchoolId },
  { model: "Report", delegate: "report", operational: true, schoolScope: bySchoolId },
  { model: "SupportTicket", delegate: "supportTicket", operational: true, schoolScope: bySchoolId },
  // After SupportTicket — UnlockGrant.ticketId and Notification.ticketId both
  // point at it.
  { model: "UnlockGrant", delegate: "unlockGrant", operational: true, schoolScope: bySchoolId },
  // The chat tables come before Notification, which points at ChatChannel, and
  // after User and School, which they point at. Within themselves the order is
  // the obvious one: a channel holds messages, a message holds mentions.
  { model: "ChatChannel", delegate: "chatChannel", operational: true, schoolScope: bySchoolId },
  { model: "ChatMessage", delegate: "chatMessage", operational: true, schoolScope: byChannel },
  {
    model: "ChatMention",
    delegate: "chatMention",
    operational: true,
    schoolScope: (schoolId) => ({ message: { channel: { schoolId } } }),
  },
  { model: "ChatRead", delegate: "chatRead", operational: true, schoolScope: byChannel },
  { model: "Notification", delegate: "notification", operational: true, schoolScope: bySchoolId },
  // `AuditLog.schoolId` is a plain nullable column, not a relation (see the
  // note at the top). A school-scoped clear takes that school's trail and
  // leaves the system-wide rows, whose `schoolId` is null, standing.
  { model: "AuditLog", delegate: "auditLog", operational: true, schoolScope: bySchoolId },
];

/**
 * Prisma's implicit many-to-many join table for `GradeLevel.teachers` /
 * `User.taughtGrades`. It has no model and no delegate, so `findMany` cannot
 * reach it — a snapshot built only from `SNAPSHOT_MODELS` would restore every
 * teacher and every grade level and quietly lose which teacher teaches which
 * grade. It is read and written with raw SQL instead.
 *
 * `A` is the GradeLevel id and `B` is the User id: Prisma orders the two sides
 * alphabetically by model name, and `GradeLevel` sorts before `User`.
 */
export const TEACHER_GRADES_JOIN = {
  table: "_TeacherGrades",
  /** GradeLevel.id */
  a: "A",
  /** User.id */
  b: "B",
} as const;

/**
 * Tables that exist in the database but not in `schema.prisma`, deliberately
 * left out of every snapshot, reset and restore.
 *
 * They are a Google-Sheets sync subsystem created out of band: no model, no
 * migration, and nothing in `src/` reads them. Two reasons they stay excluded
 * rather than getting swept in:
 *
 *  - `MasterSyncConfig.masterApiKey` is a plaintext key column, and backups are
 *    downloadable. A backup file must not carry a live credential out of the
 *    system.
 *  - Nothing in the app writes them, so wiping them on a reset would destroy
 *    data this app cannot recreate, to no benefit.
 *
 * If that subsystem is ever adopted properly it should get a real model, at
 * which point it joins `SNAPSHOT_MODELS` and this note goes away.
 */
export const EXCLUDED_TABLES = [
  "MasterSyncConfig",
  "SchoolSyncLink",
  "SyncInbox",
  "SyncOutbox",
] as const;

/** Insert order. */
export const WRITE_ORDER = SNAPSHOT_MODELS;

/** Delete order — strictly the reverse, never a second hand-maintained list. */
export const DELETE_ORDER = [...SNAPSHOT_MODELS].reverse();

/** The tables "Clear operational data" empties, in delete order. */
export const OPERATIONAL_DELETE_ORDER = DELETE_ORDER.filter((m) => m.operational);
