/**
 * The automatic teacher approval window.
 *
 * A Developer Admin sets a start and an end time on the Database console.
 * Any teacher who creates an account between them is approved into the school
 * they picked at sign-up, with no School Head step. Outside the window,
 * sign-up works as before: the account waits for School Head approval.
 *
 * Stored as one `SystemSetting` row (JSON `{ start, end }`, ISO strings).
 * One programme-wide window, not one per school: the request was one rollout
 * decision. A missing, unreadable or malformed row means "no window", so every
 * failure falls back to the School Head approval that already exists.
 *
 * Pure: no `server-only`, no Prisma. The setting reader lives in
 * `@/lib/settings/system-settings`.
 */

export const AUTO_APPROVE_WINDOW_KEY = "teachers.autoApproveWindow";

/** The longest window the console accepts. A forgotten window must run out. */
export const AUTO_APPROVE_MAX_DAYS = 30;
export const AUTO_APPROVE_MAX_MS = AUTO_APPROVE_MAX_DAYS * 24 * 60 * 60 * 1000;

export type AutoApproveWindow = { start: Date; end: Date };

export type AutoApproveState = "off" | "scheduled" | "open" | "ended";

/** Parse the stored value. Anything but a well-formed window reads as none. */
export function parseAutoApproveWindow(raw: string | null | undefined): AutoApproveWindow | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { start, end } = parsed as { start?: unknown; end?: unknown };
  if (typeof start !== "string" || typeof end !== "string") return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  if (endDate.getTime() <= startDate.getTime()) return null;
  return { start: startDate, end: endDate };
}

export function serializeAutoApproveWindow(window: AutoApproveWindow): string {
  return JSON.stringify({ start: window.start.toISOString(), end: window.end.toISOString() });
}

/** Start inclusive, end exclusive. */
export function isWithinAutoApproveWindow(
  window: AutoApproveWindow | null,
  now: Date = new Date()
): boolean {
  if (!window) return false;
  const t = now.getTime();
  return t >= window.start.getTime() && t < window.end.getTime();
}

export function autoApproveState(
  window: AutoApproveWindow | null,
  now: Date = new Date()
): AutoApproveState {
  if (!window) return "off";
  if (now.getTime() < window.start.getTime()) return "scheduled";
  if (now.getTime() >= window.end.getTime()) return "ended";
  return "open";
}

/**
 * Check a window an admin is about to save. Returns the message to show, or
 * null when it is acceptable.
 */
export function validateAutoApproveWindow(
  window: AutoApproveWindow,
  now: Date = new Date()
): string | null {
  if (window.end.getTime() <= window.start.getTime()) {
    return "The end time must be after the start time.";
  }
  if (window.end.getTime() <= now.getTime()) {
    return "The end time has already passed.";
  }
  if (window.end.getTime() - window.start.getTime() > AUTO_APPROVE_MAX_MS) {
    return `The window can be at most ${AUTO_APPROVE_MAX_DAYS} days long.`;
  }
  return null;
}
