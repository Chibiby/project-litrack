import { describe, expect, it } from "vitest";
import {
  BLOB_POINTS,
  MAX_WOBBLE,
  blobPath,
  blobRevealFrames,
  makeBlobSeed,
  radiusProgress,
  wobbleAt,
} from "@/components/theme/theme-blob";

/** Small deterministic generator so the tests are repeatable. */
function seeded(start: number) {
  let s = start >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const commands = (d: string) => d.replace(/[^MCZ]/g, "");
const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("theme blob reveal", () => {
  it("keeps the same path commands in every frame, so the browser can morph between them", () => {
    const frames = blobRevealFrames(100, 50, 900, makeBlobSeed(seeded(1)));
    expect(frames).toHaveLength(37);
    const expected = `M${"C".repeat(BLOB_POINTS)}Z`;
    for (const f of frames) {
      expect(f.startsWith('path("')).toBe(true);
      expect(commands(f.slice(6, -2))).toBe(expected);
    }
  });

  it("starts as a point at the toggle and ends past every viewport corner", () => {
    const [x, y, w, h] = [1180, 40, 1280, 800];
    const cover = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
    for (const s of [1, 2, 3, 4, 5]) {
      const frames = blobRevealFrames(x, y, cover, makeBlobSeed(seeded(s)));
      const first = numbers(frames[0]);
      for (let i = 0; i < first.length; i += 2) {
        expect(first[i]).toBeCloseTo(x, 0);
        expect(first[i + 1]).toBeCloseTo(y, 0);
      }
      // Every on-curve point of the last frame lies beyond the cover radius.
      const last = numbers(frames[frames.length - 1]);
      for (let i = 0; i < last.length; i += 6) {
        const [px, py] = i === 0 ? [last[0], last[1]] : [last[i - 2], last[i - 1]];
        expect(Math.hypot(px - x, py - y)).toBeGreaterThan(cover);
      }
    }
  });

  it("draws a different shape for each seed and moves while it grows", () => {
    const a = makeBlobSeed(seeded(7));
    const b = makeBlobSeed(seeded(8));
    expect(blobPath(0, 0, 100, a, 0.5)).not.toBe(blobPath(0, 0, 100, b, 0.5));
    // Same seed, same size, later moment: the edge has drifted.
    expect(blobPath(0, 0, 100, a, 0.2)).not.toBe(blobPath(0, 0, 100, a, 0.8));
  });

  it("never wobbles further than MAX_WOBBLE", () => {
    for (let s = 0; s < 20; s++) {
      const seed = makeBlobSeed(seeded(s));
      const total = seed.waves.reduce((n, w) => n + w.amp, 0);
      expect(total).toBeCloseTo(MAX_WOBBLE, 6);
      for (let a = 0; a < Math.PI * 2; a += 0.1) {
        expect(Math.abs(wobbleAt(seed, a, 0.5))).toBeLessThanOrEqual(MAX_WOBBLE + 1e-9);
      }
    }
  });

  it("grows slowly first, then steadily, and never shrinks", () => {
    expect(radiusProgress(0)).toBe(0);
    expect(radiusProgress(0.25)).toBeLessThan(0.12);
    expect(radiusProgress(1)).toBe(1);
    let last = 0;
    for (let t = 0; t <= 1; t += 0.01) {
      const r = radiusProgress(t);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});
