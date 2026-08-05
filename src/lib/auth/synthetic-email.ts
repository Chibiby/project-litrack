/**
 * The login UI uses (School Name + School ID / username) instead of email/password.
 * Supabase Auth requires email+password. We bridge them with synthetic emails.
 *
 *  - School Head:  sh@<schoolIdCode>.<DOMAIN>
 *  - Teacher:      <username>@school.local  (username from SH create or invite accept)
 *
 * The Supabase password used by School Head login is the school's `schoolIdCode`.
 * Teachers use the password set at create/invite-accept time.
 */
const DOMAIN = process.env.SYNTHETIC_EMAIL_DOMAIN || "litrack.local";

export function schoolHeadSyntheticEmail(schoolIdCode: string): string {
  const safe = schoolIdCode.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `sh@${safe}.${DOMAIN}`;
}

/** Teacher login identity — must match `loginTeacher` synthetic email construction. */
export function teacherSyntheticEmail(username: string): string {
  const safe = username.trim().toLowerCase();
  return `${safe}@school.local`;
}
