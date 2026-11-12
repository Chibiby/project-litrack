/**
 * Whether a school year is open, from the Division Admin's active duration.
 * Pure: shared by the server gate, the header badge and tests.
 *
 * Window bounds are UTC-midnight dates (first day of the start month, last day
 * of the end month); `todayKey` is the school's local `YYYY-MM-DD`.
 */

export type ClosedReason =
  /** The school has no active SchoolYear row. */
  | "NO_ACTIVE_YEAR"
  /** The Division Admin has not set an active duration for this label. */
  | "NO_WINDOW"
  /** The duration has not started yet. */
  | "NOT_STARTED"
  /** The duration has ended. */
  | "ENDED";

export type WindowState = {
  open: boolean;
  reason: ClosedReason | null;
  /** True during the duration's last month: promotion unlocks. */
  isLastMonth: boolean;
};

export function dateKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function evaluateWindow(
  window: { activeStart: Date; activeEnd: Date } | null,
  todayKey: string
): WindowState {
  if (!window) return { open: false, reason: "NO_WINDOW", isLastMonth: false };
  const start = dateKeyUtc(window.activeStart);
  const end = dateKeyUtc(window.activeEnd);
  if (todayKey < start) return { open: false, reason: "NOT_STARTED", isLastMonth: false };
  if (todayKey > end) return { open: false, reason: "ENDED", isLastMonth: false };
  return { open: true, reason: null, isLastMonth: todayKey.slice(0, 7) === end.slice(0, 7) };
}
