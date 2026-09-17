/**
 * Pure helpers behind `process-image.ts`'s browser pipeline. No DOM globals —
 * unit-testable without jsdom — so the math (fallback mime choice, crop rect
 * clamping/rescaling, the downscale target, the quality step-down plan) is
 * verifiable independent of `<canvas>`/`<img>`.
 */

export type Dimensions = {
  width: number;
  height: number;
};

/** react-easy-crop's `Area` shape: a crop rect in source-image pixels. */
export type CropRectPixels = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * `canvas.toBlob(..., "image/webp", q)` silently falls back to another format
 * in a browser that cannot encode WebP (old Safari) — the blob it hands back
 * is the only place that shows up. Decide the output mime from the produced
 * blob's actual type, never from the user agent string.
 */
export function chooseOutputMime(producedType: string): "image/webp" | "image/jpeg" {
  return producedType === "image/webp" ? "image/webp" : "image/jpeg";
}

/**
 * Clamp a crop rectangle to the bounds of the image it is drawn from.
 * react-easy-crop already keeps its rect on-image, but rescaling it onto a
 * downscaled working canvas (`scaleCropRect`) can push it a fraction of a
 * pixel past the edge from rounding — clamping here is what keeps
 * `drawImage` from silently drawing a blank strip instead of throwing.
 */
export function clampCropRect(rect: CropRectPixels, bounds: Dimensions): CropRectPixels {
  const boundedWidth = Math.max(1, Math.min(Math.round(rect.width), Math.max(1, bounds.width)));
  const boundedHeight = Math.max(1, Math.min(Math.round(rect.height), Math.max(1, bounds.height)));
  const x = Math.min(Math.max(0, Math.round(rect.x)), Math.max(0, bounds.width - boundedWidth));
  const y = Math.min(Math.max(0, Math.round(rect.y)), Math.max(0, bounds.height - boundedHeight));
  return { x, y, width: boundedWidth, height: boundedHeight };
}

/**
 * Rescale a crop rect computed against one image size onto a same-aspect
 * image at a different size — used because the crop dialog measures its rect
 * against the originally decoded image, while `processAvatarImage` downscales
 * before it draws the crop.
 */
export function scaleCropRect(
  rect: CropRectPixels,
  from: Dimensions,
  to: Dimensions
): CropRectPixels {
  const scaleX = from.width > 0 ? to.width / from.width : 1;
  const scaleY = from.height > 0 ? to.height / from.height : 1;
  return {
    x: rect.x * scaleX,
    y: rect.y * scaleY,
    width: rect.width * scaleX,
    height: rect.height * scaleY,
  };
}

/**
 * Target size for the "downscale to at most `maxEdge` on the long edge
 * before cropping" step. Unchanged when the long edge is already at or under
 * `maxEdge` — this only ever shrinks, never upscales a small photo.
 */
export function planDownscale(size: Dimensions, maxEdge: number): Dimensions {
  const longEdge = Math.max(size.width, size.height);
  if (longEdge <= maxEdge || longEdge <= 0) return { width: size.width, height: size.height };
  const scale = maxEdge / longEdge;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * Quality values to try in order when a produced blob is still over its byte
 * ceiling: the starting quality, then decreasing steps down to `floor`.
 * `planQualitySteps(0.8)` → `[0.8, 0.7, 0.6, 0.5]`.
 */
export function planQualitySteps(startQuality: number, floor = 0.5, step = 0.1): number[] {
  const steps = [startQuality];
  let next = startQuality - step;
  while (next >= floor - 1e-9) {
    steps.push(Math.round(next * 100) / 100);
    next -= step;
  }
  return steps;
}
