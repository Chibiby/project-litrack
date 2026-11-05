/**
 * Displacement map for the Liquid Glass sign-in card.
 *
 * Apple's Liquid Glass reads as a thick convex lens: the backdrop is clear in
 * the middle and bends along the rim. On the web that bend is an SVG
 * `feDisplacementMap` (used through `backdrop-filter: url(#id)`, Chromium
 * only). Each pixel's red channel moves the sampled backdrop along x and the
 * green channel along y; 128 means "no move".
 *
 * This builds that map for a rounded rectangle: neutral everywhere except a
 * bezel band along the edge, where pixels sample further inward the closer
 * they are to the edge. That squeezes the backdrop toward the rim, which is
 * the lens look. Pure, so it can be tested without a canvas.
 */
export type LiquidGlassMapInput = {
  width: number;
  height: number;
  /** Corner radius in CSS pixels. */
  radius: number;
  /** Width of the refracting band along the edge, in CSS pixels. */
  bezel: number;
};

const NEUTRAL = 128;

export function buildLiquidGlassMap({
  width,
  height,
  radius,
  bezel,
}: LiquidGlassMapInput): Uint8ClampedArray<ArrayBuffer> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const data = new Uint8ClampedArray(w * h * 4);
  const halfW = w / 2;
  const halfH = h / 2;
  const r = Math.max(0, Math.min(radius, halfW, halfH));
  const band = Math.max(1, bezel);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Position relative to the centre, measured at the pixel's centre.
      const px = x + 0.5 - halfW;
      const py = y + 0.5 - halfH;
      const qx = Math.abs(px) - (halfW - r);
      const qy = Math.abs(py) - (halfH - r);

      // Distance inside the rounded rectangle and the outward edge normal.
      let inside: number;
      let nx: number;
      let ny: number;
      if (qx > 0 && qy > 0) {
        const len = Math.hypot(qx, qy) || 1;
        inside = r - len;
        nx = (qx / len) * Math.sign(px);
        ny = (qy / len) * Math.sign(py);
      } else if (qx > qy) {
        inside = r - qx;
        nx = Math.sign(px) || 1;
        ny = 0;
      } else {
        inside = r - qy;
        nx = 0;
        ny = Math.sign(py) || 1;
      }

      const i = (y * w + x) * 4;
      let rCh = NEUTRAL;
      let gCh = NEUTRAL;
      if (inside >= 0 && inside < band) {
        // Convex profile: strongest bend at the edge, fading to flat glass.
        const t = 1 - inside / band;
        const magnitude = t * t;
        // Sample inward, so the outward normal is negated.
        rCh = NEUTRAL - nx * magnitude * 127;
        gCh = NEUTRAL - ny * magnitude * 127;
      }
      data[i] = rCh;
      data[i + 1] = gCh;
      data[i + 2] = NEUTRAL;
      data[i + 3] = 255;
    }
  }
  return data;
}
