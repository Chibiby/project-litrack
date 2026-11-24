/**
 * Pure half of the stat-card count-up (`src/components/ui/count-up.tsx`).
 *
 * Practice this follows:
 * - Count once, on the first visit to a page in a sign-in, never on every
 *   refresh or revisit: repeated motion on numbers people come back to read
 *   becomes noise.
 * - A fast start and a long settle (ease-out), so the eye lands on the final
 *   figure instead of watching it crawl.
 * - Reduced motion shows the final value at once; the final value is always
 *   what assistive tech reads, never a mid-count number.
 * - Tabular numerals (already on the card) so digits do not jitter.
 */

/** How long one count runs. Short enough not to hold the reader up. */
export const COUNT_UP_MS = 1100;

/** easeOutExpo: rushes, then settles on the figure. */
export function easeOutExpo(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - Math.pow(2, -10 * t);
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
  return Math.round(target * easeOutExpo(Math.max(0, elapsed) / duration));
}

export const COUNT_UP_STORAGE_KEY = "litrack.countUp.seen";

/** Storage the decision is read from; `sessionStorage` in the browser. */
export type SeenStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Whether the cards on `page` should count this time, marking the page as
 * seen. Every card on one page asks in the same moment, so a fresh "yes" is
 * remembered for `windowMs` and handed to the rest of that page's cards;
 * after that window a revisit gets "no". Storage that throws (private mode,
 * blocked site data) means "no": the numbers simply appear.
 */
export function createCountUpGate(store: () => SeenStore | null, now: () => number, windowMs = 1500) {
  const fresh = new Map<string, number>();
  return function shouldCount(page: string): boolean {
    const at = fresh.get(page);
    if (at !== undefined && now() - at < windowMs) return true;
    try {
      const s = store();
      if (!s) return false;
      const seen: string[] = JSON.parse(s.getItem(COUNT_UP_STORAGE_KEY) ?? "[]");
      if (seen.includes(page)) return false;
      s.setItem(COUNT_UP_STORAGE_KEY, JSON.stringify([...seen, page]));
      fresh.set(page, now());
      return true;
    } catch {
      return false;
    }
  };
}

/** Forget every seen page, so a new sign-in counts again. */
export function resetCountUp(store: SeenStore | null): void {
  try {
    store?.removeItem(COUNT_UP_STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was remembered either.
  }
}
