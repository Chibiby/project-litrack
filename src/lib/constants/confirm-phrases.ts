/**
 * The exact words an admin must type to confirm a destructive database action.
 *
 * These live here, and not next to the actions that check them, for a reason
 * worth keeping: `src/lib/actions/database.ts` is a `"use server"` module, and
 * such a module may export **nothing but async functions**. Not a string, not a
 * const object, not an `as const` map. Next validates that boundary when it
 * bundles a route that reaches the module, and the failure is neither a type
 * error nor a build error — it is a runtime throw the moment the route's action
 * chunk loads:
 *
 *   A "use server" file can only export async functions, found object.
 *
 * Worse, it lands on whatever page pulled the module into its chunk, which can
 * be a page that has nothing to do with the database console. That is exactly
 * how this surfaced: as `/admin/schools/[schoolId]` failing to remove a teacher,
 * with a reference code and no mention of the real file.
 *
 * So: the phrases are defined in this plain module, the server actions import
 * them to check a submission, and the console imports them to render the prompt.
 * One source of truth, and the words the user is asked to type cannot drift from
 * the words the server compares against.
 */
export const CONFIRM_PHRASES = {
  restore: "RESTORE",
  resetOperational: "CLEAR DATA",
  resetSchoolAccounts: "RESET ACCOUNTS",
  removeTeachers: "REMOVE TEACHERS",
  noBackupAck: "NO BACKUP, NOT REVERSIBLE",
} as const;

export type ConfirmPhrase = (typeof CONFIRM_PHRASES)[keyof typeof CONFIRM_PHRASES];
