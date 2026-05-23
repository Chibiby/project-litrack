/**
 * The login UI uses (School Name + School ID) instead of email/password.
 * Supabase Auth requires email+password. We bridge them with synthetic emails.
 *
 *  - School Head:  sh@<schoolIdCode>.<DOMAIN>
 *  - Teacher:      uses real email captured during invitation (so they can receive the invite)
 *
 * The Supabase password used by School Head login is the school's `schoolIdCode`.
 * Teachers set their own password during invite acceptance.
 */
const DOMAIN = process.env.SYNTHETIC_EMAIL_DOMAIN || "litrack.local";

export function schoolHeadSyntheticEmail(schoolIdCode: string): string {
  const safe = schoolIdCode.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `sh@${safe}.${DOMAIN}`;
}
