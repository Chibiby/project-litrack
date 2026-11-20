/**
 * Every rate limit in LITRACK, in one place.
 *
 * Call sites read their numbers from here (`RATE_LIMITS.login`, …), so the
 * Developer Controls "Rate limits" page always shows what the code enforces.
 * Change a limit here and both move together.
 *
 * Pure: no `server-only`, no Prisma. Safe to import from a "use server" file,
 * which may not export constants of its own.
 */

/** SystemSetting key for the pause switch on the Rate limits page. "true" pauses every limit. */
export const RATE_LIMITS_PAUSED_KEY = "rateLimits.paused";

/** What a limit counts attempts against. */
export type RateLimitScope = "network" | "account" | "school" | "admin" | "system";

export type RateLimitEntry = {
  /** Max attempts inside the window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Short name for the page. */
  label: string;
  /** What it protects, in the user's words. */
  description: string;
  scope: RateLimitScope;
  /** What one counter is shared by, in the user's words. */
  per: string;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function entry(e: RateLimitEntry): RateLimitEntry {
  return e;
}

export const RATE_LIMITS = {
  // ── From the same network (one IP address) ─────────────────────────────
  schoolsList: entry({
    limit: 60,
    windowMs: MINUTE,
    label: "School list",
    description: "Loading the list of schools from the public API.",
    scope: "network",
    per: "IP address",
  }),
  schoolFailedSignIn: entry({
    limit: 20,
    windowMs: 15 * MINUTE,
    label: "Wrong passwords: teachers and School Heads",
    description:
      "Wrong passwords on the teacher and School Head sign-in forms. Only failures count; correct sign-ins never use it up.",
    scope: "network",
    per: "IP address",
  }),
  adminFailedSignIn: entry({
    limit: 20,
    windowMs: 15 * MINUTE,
    label: "Wrong passwords: admins",
    description: "Failed sign-ins on the admin sign-in page. Only failures count.",
    scope: "network",
    per: "IP address",
  }),
  lookupFailure: entry({
    limit: 10,
    windowMs: 10 * MINUTE,
    label: "Unknown or taken emails",
    description:
      "Signing in with an email that has no account, or creating an account with an email already in use. Once used up, every sign-in and sign-up from that network waits.",
    scope: "network",
    per: "IP address",
  }),

  // ── Per account, email or person ──────────────────────────────────────────
  login: entry({
    limit: 10,
    windowMs: 5 * MINUTE,
    label: "Sign-in attempts",
    description: "Sign-in attempts on one account, right or wrong.",
    scope: "account",
    per: "account (teacher email at a school, School Head's school, admin username)",
  }),
  register: entry({
    limit: 5,
    windowMs: 15 * MINUTE,
    label: "Create account",
    description: "Creating a teacher account with the same email at the same school.",
    scope: "account",
    per: "email at a school",
  }),
  passwordRecovery: entry({
    limit: 5,
    windowMs: 15 * MINUTE,
    label: "Forgot password emails",
    description: "Asking for a password reset email.",
    scope: "account",
    per: "email",
  }),
  password: entry({
    limit: 10,
    windowMs: 15 * MINUTE,
    label: "Password changes",
    description: "Setting, changing or resetting a password.",
    scope: "account",
    per: "account",
  }),
  emailChange: entry({
    limit: 10,
    windowMs: 15 * MINUTE,
    label: "Email changes",
    description: "Changing the email on an account.",
    scope: "account",
    per: "account",
  }),
  avatarUpload: entry({
    limit: 10,
    windowMs: HOUR,
    label: "Profile photo uploads",
    description: "Uploading a profile photo.",
    scope: "account",
    per: "account",
  }),
  chat: entry({
    limit: 30,
    windowMs: MINUTE,
    label: "Chat messages",
    description: "Sending chat messages.",
    scope: "account",
    per: "account",
  }),
  assistant: entry({
    limit: 20,
    windowMs: HOUR,
    label: "Assistant questions",
    description: "Asking the in-app assistant a question.",
    scope: "account",
    per: "account",
  }),
  supportTicket: entry({
    limit: 5,
    windowMs: HOUR,
    label: "Support tickets",
    description: "Sending a support ticket.",
    scope: "account",
    per: "account",
  }),
  summaryExport: entry({
    limit: 20,
    windowMs: 10 * MINUTE,
    label: "Summary exports",
    description: "Exporting a Division Summary page.",
    scope: "account",
    per: "account",
  }),
  learnerPurge: entry({
    limit: 20,
    windowMs: 15 * MINUTE,
    label: "Permanently delete learners",
    description: "A teacher permanently deleting a learner.",
    scope: "account",
    per: "teacher",
  }),

  // ── Per school ────────────────────────────────────────────────────────────
  schoolHeadCredentialRegen: entry({
    limit: 5,
    windowMs: 15 * MINUTE,
    label: "New School Head sign-in details",
    description: "Generating new sign-in details for a school's School Head.",
    scope: "school",
    per: "school",
  }),

  // ── Per admin ─────────────────────────────────────────────────────────────
  accountReset: entry({
    limit: 10,
    windowMs: 15 * MINUTE,
    label: "Reset passwords for others",
    description: "An admin resetting a School Head, teacher or district admin password.",
    scope: "admin",
    per: "admin, for each account type",
  }),
  impersonate: entry({
    limit: 10,
    windowMs: 15 * MINUTE,
    label: "View as another user",
    description: "Starting to view LITRACK as another account.",
    scope: "admin",
    per: "admin",
  }),
  revealPassword: entry({
    limit: 20,
    windowMs: 15 * MINUTE,
    label: "Show School Head passwords",
    description: "Showing a School Head's saved password.",
    scope: "admin",
    per: "admin",
  }),
  archive: entry({
    limit: 20,
    windowMs: 15 * MINUTE,
    label: "Restore or delete archived records",
    description: "Restoring or permanently deleting an archived teacher or learner, counted per kind of action.",
    scope: "admin",
    per: "admin, for each action",
  }),
  removeFromSchool: entry({
    limit: 20,
    windowMs: 15 * MINUTE,
    label: "Remove teachers or learners from a school",
    description: "Removing teachers or learners in bulk from a school's page.",
    scope: "admin",
    per: "admin, for each action",
  }),
  deletedLearnerRestore: entry({
    limit: 20,
    windowMs: 15 * MINUTE,
    label: "Restore deleted learners",
    description: "Restoring a deleted learner.",
    scope: "admin",
    per: "admin",
  }),
  adminEmail: entry({
    limit: 100,
    windowMs: HOUR,
    label: "Admin emails",
    description: "Emails sent from the admin email tool, one per recipient.",
    scope: "admin",
    per: "admin",
  }),
  databaseDestructive: entry({
    limit: 5,
    windowMs: 15 * MINUTE,
    label: "Database resets and restores",
    description: "Resets, restores and undo on the Database console.",
    scope: "admin",
    per: "admin, for each action",
  }),
  databaseBackup: entry({
    limit: 10,
    windowMs: 15 * MINUTE,
    label: "Database backups",
    description: "Taking or deleting a backup on the Database console.",
    scope: "admin",
    per: "admin, for each action",
  }),

  // ── System ────────────────────────────────────────────────────────────────
  errorAlertEmail: entry({
    limit: 1,
    windowMs: 15 * MINUTE,
    label: "Error alert emails",
    description: "Alert emails to the developers about the same kind of system error.",
    scope: "system",
    per: "error code",
  }),
} as const;

export type RateLimitId = keyof typeof RATE_LIMITS;

export const RATE_LIMIT_SCOPE_LABELS: Record<RateLimitScope, string> = {
  network: "From the same network (IP address)",
  account: "Per account or email",
  school: "Per school",
  admin: "Per admin",
  system: "System",
};

/** Page order: same-network limits first, as the request asked. */
export const RATE_LIMIT_SCOPE_ORDER: readonly RateLimitScope[] = [
  "network",
  "account",
  "school",
  "admin",
  "system",
];

/** "15 minutes", "1 hour", "1 minute". */
export function formatRateWindow(windowMs: number): string {
  if (windowMs % HOUR === 0) {
    const h = windowMs / HOUR;
    return `${h} hour${h === 1 ? "" : "s"}`;
  }
  const m = Math.round(windowMs / MINUTE);
  return `${m} minute${m === 1 ? "" : "s"}`;
}
