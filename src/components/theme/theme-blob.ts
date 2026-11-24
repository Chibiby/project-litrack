/**
 * The shape of the light/dark reveal: a living, wavy ring edge instead of a
 * plain circle, different on every switch.
 *
 * How it is built (the usual "organic blob" recipe):
 * - The edge is a closed loop of points around the toggle. Each point's
 *   distance from the centre is the growing radius times (1 + wobble).
 * - The wobble is a sum of a few sine waves around the loop (2 to 7 bumps
 *   each), every one with a random strength, phase and drift speed. Summed
 *   harmonics read as smooth, noise-like motion without a noise library.
 * - The waves drift while the shape grows, so the edge keeps moving like
 *   water instead of scaling one fixed outline.
 * - A fresh random seed per switch means no two reveals look alike.
 * - Points are joined with Catmull-Rom curves turned into cubic Béziers, so
 *   the edge is smooth, and every frame has the same commands in the same
 *   order, which is what lets the browser interpolate `clip-path: path()`.
 * - The last frame's narrowest point still reaches past the far corner, so
 *   the reveal always ends with the whole page covered.
 */

export type Rand = () => number;

type Wave = { bumps: number; amp: number; phase: number; drift: number };

export type BlobSeed = { waves: Wave[]; spin: number };

/** Sum of every wave's strength: the furthest the edge can move in or out. */
export const MAX_WOBBLE = 0.22;

/** Points around the loop. Enough for 7 bumps to stay round. */
export const BLOB_POINTS = 28;

/** A new, random set of waves. `rand` is `Math.random` in the browser. */
export function makeBlobSeed(rand: Rand = Math.random): BlobSeed {
  // Three to four waves, distinct bump counts, strengths normalised so their
  // total is MAX_WOBBLE and no single wave dominates.
  const pool = [2, 3, 4, 5, 6, 7];
  const count = 3 + Math.floor(rand() * 2);
  const bumps: number[] = [];
  while (bumps.length < count) {
    const b = pool[Math.floor(rand() * pool.length)];
    if (!bumps.includes(b)) bumps.push(b);
  }
  const raw = bumps.map(() => 0.4 + rand());
  const total = raw.reduce((a, b) => a + b, 0);
  return {
    waves: bumps.map((b, i) => ({
      bumps: b,
      amp: (raw[i] / total) * MAX_WOBBLE,
      phase: rand() * Math.PI * 2,
      // Radians of drift over the whole reveal; either direction.
      drift: (rand() * 2 - 1) * Math.PI * 1.6,
    })),
    spin: (rand() * 2 - 1) * 0.6,
  };
}

/** The edge's relative wobble at angle `a`, `t` (0..1) through the reveal. */
export function wobbleAt(seed: BlobSeed, a: number, t: number): number {
  let w = 0;
  for (const wave of seed.waves) {
    w += wave.amp * Math.sin(wave.bumps * (a + seed.spin * t) + wave.phase + wave.drift * t);
  }
  return w;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * One closed, smooth outline around (`cx`, `cy`) with base radius `radius`.
 * Always `M`, then exactly `BLOB_POINTS` `C` segments, then `Z`.
 */
export function blobPath(cx: number, cy: number, radius: number, seed: BlobSeed, t: number): string {
  const pts: [number, number][] = [];
  for (let i = 0; i < BLOB_POINTS; i++) {
    const a = (i / BLOB_POINTS) * Math.PI * 2;
    const r = radius * (1 + wobbleAt(seed, a, t));
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  const at = (i: number) => pts[(i + BLOB_POINTS) % BLOB_POINTS];
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 0; i < BLOB_POINTS; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${r1(c1x)} ${r1(c1y)} ${r1(c2x)} ${r1(c2y)} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return `${d}Z`;
}

/**
 * The radius curve: the existing reveal's slow start, then a steady sweep
 * (the same points as the CSS `linear()` easing in theme-waves.ts).
 */
const RADIUS_CURVE: [number, number][] = [
  [0, 0],
  [0.0248, 0.0007],
  [0.0496, 0.0028],
  [0.0744, 0.0066],
  [0.0992, 0.0123],
  [0.124, 0.0201],
  [0.1488, 0.0305],
  [0.1736, 0.0438],
  [0.1984, 0.0607],
  [0.2233, 0.0818],
  [0.2481, 0.1082],
  [1, 1],
];

export function radiusProgress(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  for (let i = 1; i < RADIUS_CURVE.length; i++) {
    const [x1, y1] = RADIUS_CURVE[i];
    if (t <= x1) {
      const [x0, y0] = RADIUS_CURVE[i - 1];
      return y0 + ((t - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return 1;
}

/**
 * Keyframes for `clip-path`, evenly spaced in time (play them with linear
 * easing; the radius curve is baked in). `cover` is the distance from the
 * origin to the farthest viewport corner.
 */
export function blobRevealFrames(
  x: number,
  y: number,
  cover: number,
  seed: BlobSeed,
  frames = 36
): string[] {
  // Grow past `cover` far enough that even the deepest dip clears the corner.
  const end = cover / (1 - MAX_WOBBLE) + 4;
  const out: string[] = [];
  for (let i = 0; i <= frames; i++) {
    const t = i / frames;
    out.push(`path("${blobPath(x, y, end * radiusProgress(t), seed, t)}")`);
  }
  return out;
}
