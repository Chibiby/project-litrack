/**
 * Pure half of the stat-card count-up (`src/components/ui/count-up.tsx`).
 *
 * Practice this follows:
 * - Count on the first visit to a page after the app loads: a refresh counts
 *   again, moving between pages and back does not.
 * - Start only once the page has finished loading, so the count plays while
 *   someone is looking, not behind a loading screen.
 * - A steady ease-out over about two seconds, slow enough to follow.
 * - Reduced motion shows the final value at once; the final value is always
 *   what assistive tech reads, never a mid-count number.
 * - Tabular numerals (already on the card) so digits do not jitter.
 */

/** How long one count runs. */
export const COUNT_UP_MS = 2200;

/** easeOutCubic: a steady climb that slows into the figure. */
export function easeOutCubic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(1 - t, 3);
}

export type CountableValue = { target: number; format: (n: number) => string };

/**
 * A stat value that can count: a finite non-negative number, or a string of
 * digits with optional thousands commas and an optional "%" (as cards render
 * "103,110" or "55%"). Anything else ("Not chosen", "3/4", "2.5") is shown
 * as it is.
 */
export function parseCountable(value: number | string): CountableValue | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null;
    return { target: value, format: (n) => String(n) };
  }
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(%?)$/.exec(value.trim());
  if (!m) return null;
  const commas = m[1].includes(",");
  const suffix = m[2];
  const target = Number(m[1].replaceAll(",", ""));
  if (!Number.isSafeInteger(target)) return null;
  return {
    target,
    format: (n) => (commas ? n.toLocaleString("en-US") : String(n)) + suffix,
  };
}

/** The figure shown `elapsed` ms into the count. Ends exactly on `target`. */
export function countUpFrame(target: number, elapsed: number, duration = COUNT_UP_MS): number {
  if (elapsed >= duration) return target;
  return Math.round(target * easeOutCubic(Math.max(0, elapsed) / duration));
}

/**
 * Decides whether the cards on a page should count. The memory lives in this
 * module, so a page refresh (a new page load) forgets it and counts again,
 * while moving between pages inside the app does not. Every card on one page
 * asks in the same moment, so a fresh "yes" is handed to the rest of that
 * page's cards for `windowMs`.
 */
export function createCountUpGate(now: () => number, windowMs = 1500) {
  const seen = new Map<string, number>();
  return {
    shouldCount(page: string): boolean {
      const at = seen.get(page);
      if (at === undefined) {
        seen.set(page, now());
        return true;
      }
      return now() - at < windowMs;
    },
    /** Forget every seen page, so a new sign-in counts again. */
    reset(): void {
      seen.clear();
    },
  };
}
