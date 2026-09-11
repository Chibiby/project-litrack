/**
 * The address a removed teacher signed in with, read back out of the tombstone
 * their removal wrote — or null when the tombstone did not keep it.
 *
 * Removal rewrites `User.email` so the same address can register again, and the
 * two removal paths rewrite it differently:
 *   - School Head Remove (`removeTeacher`) appends `.deleted.<timestamp>`, so the
 *     original is everything before that suffix.
 *   - Super Admin removal (`removeTeacherRows`) replaces it outright with
 *     `removed+<userId>@…`, so there is nothing to recover.
 *
 * Pure and dependency-free, so the Removed tab and its test share one parser.
 */
const SCHOOL_HEAD_SUFFIX = /\.deleted\.\d+$/;
const SUPER_ADMIN_TOMBSTONE = /^removed\+[^@]+@/;

export function originalTeacherEmail(email: string): string | null {
  if (SUPER_ADMIN_TOMBSTONE.test(email)) return null;
  return email.replace(SCHOOL_HEAD_SUFFIX, "");
}
