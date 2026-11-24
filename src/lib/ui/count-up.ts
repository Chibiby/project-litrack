/**
 * Pure half of the stat-card count-up (`src/components/ui/count-up.tsx`).
 *
 * Practice this follows:
 * - Count once per page load: a refresh counts again, moving between pages
 *   and back does not.
 * - Start as soon as the card is on screen (at least half visible),
 *   so the count plays while someone is looking.
 * - Ease-out cubic over 1.2 s, with cards on one page starting 100 ms apart.
 * - Thousands separators always ("103,110", never "103110").
 * - Reduced motion shows the final value at once; the final value is always
 *   what assistive tech reads, never a mid-count number.
 * - Tabular numerals (already on the card) so digits do not jitter.
 */

/** How long one count runs. */
export const COUNT_UP_MS = 1200;

/** Gap between the starts of cards that become ready together. */
export const COUNT_UP_STAGGER_MS = 100;

/** easeOutCubic: a steady climb that slows into the figure. */
export function easeOutCubic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(1 - t, 3);
}

function withCommas(n: number): string {
  return n.toLocaleString("en-US");
}

/** How a stat card shows `value` when it is not counting. */
export function formatStatValue(value: number | string): string {
  const c = parseCountable(value);
  return c ? c.format(c.target) : String(value);
}

export type CountableValue = { target: number; format: (n: number) => string };

/**
 * A stat value that can count: a finite non-negative whole number, or a
 * string of digits with optional thousands commas and an optional "%" (as
 * cards render "103,110" or "55%"). It always formats with thousands commas.
 * Anything else ("Not chosen", "3/4", "2.5", "2026-2027") is shown as it is.
 */
export function parseCountable(value: number | string): CountableValue | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) return null;
    return { target: value, format: withCommas };
  }
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(%?)$/.exec(value.trim());
  if (!m) return null;
  const suffix = m[2];
  const target = Number(m[1].replaceAll(",", ""));
  if (!Number.isSafeInteger(target)) return null;
  return {
    target,
    format: (n) => withCommas(n) + suffix,
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

/**
 * Hands out start delays so cards that become ready in the same moment start
 * `gapMs` apart, in the order they ask (page order). A card that asks after
 * the queue has drained starts at once.
 */
export function createStagger(gapMs = COUNT_UP_STAGGER_MS) {
  let nextAt = -Infinity;
  return function delayFor(now: number): number {
    const at = Math.max(now, nextAt);
    nextAt = at + gapMs;
    return at - now;
  };
}
