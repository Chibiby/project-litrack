/**
 * The default password for a School Head account: the bare DepEd School ID.
 *
 * A school and its extensions share one DepEd ID, and every head in that group
 * starts on it. The stored `schoolIdCode` cannot be shared, because
 * `schoolHeadSyntheticEmail` builds the head's Supabase login address from it,
 * so the second and later schools of a group are stored as `<id>-2`, `<id>-3`, …
 * (`assignSchoolCredentials` in src/lib/import/school-credentials.ts). This is
 * the inverse of that suffix. Sharing the password is safe: sign-in resolves the
 * account from the selected school, never from the password.
 *
 * Only a six-digit base is recognised, which is every real DepEd School ID and
 * the no-ID placeholder `123456`. A code an admin typed with a dash of its own
 * (`SCHOOL-1`) is left whole rather than turned into a password nobody set.
 *
 * Every path that sets or shows a School Head's default password goes through
 * here — create, both resets, the bulk reset, and the console row — so none of
 * them can hand out a credential the others do not honour.
 */
export function defaultSchoolHeadPassword(schoolIdCode: string): string {
  const extension = /^(\d{6})-\d+$/.exec(schoolIdCode);
  return extension ? extension[1] : schoolIdCode;
}
