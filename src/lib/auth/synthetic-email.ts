/**
 * Login UI uses school selection + credentials instead of raw email for SH/teachers.
 * Supabase Auth still requires an email address — we bridge with synthetic emails.
 *
 *  - School Head:  sh@<schoolIdCode>.<DOMAIN>
 *  - Teacher:      <username>@school.local  (username = teacher.<lastname>.<4hex>)
 *
 * Synthetic-email accounts cannot use email recovery; Super Admin (SH) or School Head
 * (teachers via invite resend) must regenerate credentials.
 */

const DOMAIN = process.env.SYNTHETIC_EMAIL_DOMAIN || "litrack.local";

/** Hardcoded for compatibility with existing teacher accounts created before env-based domains. */
export const TEACHER_EMAIL_DOMAIN = "school.local";

export function schoolHeadSyntheticEmail(schoolIdCode: string): string {
  const safe = schoolIdCode.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  return `sh@${safe}.${DOMAIN}`;
}

/** Build teacher login username: teacher.<lastname>.<4hex> */
export function teacherUsername(lastName: string, hex4: string): string {
  const safeLast = lastName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const suffix = hex4.toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 4);
  return `teacher.${safeLast}.${suffix}`;
}

export function teacherSyntheticEmail(username: string): string {
  const safe = username.trim().toLowerCase();
  return `${safe}@${TEACHER_EMAIL_DOMAIN}`;
}

export function usernameFromTeacherEmail(email: string): string | null {
  const suffix = `@${TEACHER_EMAIL_DOMAIN}`;
  if (!email.toLowerCase().endsWith(suffix)) return null;
  return email.slice(0, -suffix.length);
}

export function isSyntheticEmail(email: string): boolean {
  const lower = email.toLowerCase();
  if (lower.endsWith(`@${TEACHER_EMAIL_DOMAIN}`)) return true;
  // School Head: sh@<code>.<domain>
  if (lower.startsWith("sh@") && lower.endsWith(`.${DOMAIN.toLowerCase()}`)) return true;
  return false;
}
