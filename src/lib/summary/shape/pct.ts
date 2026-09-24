/**
 * The one rounding rule for every summary percentage (spec 3.6): one decimal,
 * and null when there is nothing to be a percentage of, so an empty cell
 * renders "—" instead of a false 0%.
 */
export function pct(count: number, base: number): number | null {
  if (!(base > 0)) return null;
  return round1((count / base) * 100);
}

/** Round to one decimal, half away from zero. */
export function round1(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value) * 10) / 10;
}

/** Average of `sum` over `n`, one decimal; null when `n` is 0. */
export function mean(sum: number, n: number): number | null {
  if (!(n > 0)) return null;
  return round1(sum / n);
}
