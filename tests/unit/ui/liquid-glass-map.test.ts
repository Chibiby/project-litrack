import { describe, expect, it } from "vitest";
import { buildLiquidGlassMap } from "@/lib/ui/liquid-glass-map";

const W = 200;
const H = 120;
const map = buildLiquidGlassMap({ width: W, height: H, radius: 16, bezel: 30 });
const px = (x: number, y: number) => {
  const i = (y * W + x) * 4;
  return { r: map[i], g: map[i + 1], b: map[i + 2], a: map[i + 3] };
};

describe("buildLiquidGlassMap", () => {
  it("is one opaque RGBA pixel per CSS pixel", () => {
    expect(map.length).toBe(W * H * 4);
    expect(px(0, 0).a).toBe(255);
    expect(px(100, 60).b).toBe(128);
  });

  it("leaves the flat middle of the glass undisplaced", () => {
    expect(px(100, 60)).toMatchObject({ r: 128, g: 128 });
  });

  it("samples inward at every edge, strongest at the rim", () => {
    // Left edge looks right (+x), right edge looks left (-x).
    expect(px(0, 60).r).toBeGreaterThan(240);
    expect(px(W - 1, 60).r).toBeLessThan(16);
    // Top edge looks down (+y), bottom edge looks up (-y).
    expect(px(100, 0).g).toBeGreaterThan(240);
    expect(px(100, H - 1).g).toBeLessThan(16);
    // Straight edges do not shift along the other axis.
    expect(px(0, 60).g).toBe(128);
    expect(px(100, 0).r).toBe(128);
  });

  it("fades out across the bezel", () => {
    const edge = px(0, 60).r - 128;
    const mid = px(15, 60).r - 128;
    const past = px(31, 60).r - 128;
    expect(edge).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(0);
    expect(past).toBe(0);
  });

  it("bends corners diagonally inward", () => {
    const corner = px(6, 6);
    expect(corner.r).toBeGreaterThan(128);
    expect(corner.g).toBeGreaterThan(128);
  });

  it("leaves pixels outside the rounded corner neutral", () => {
    expect(px(0, 0)).toMatchObject({ r: 128, g: 128 });
  });
});
