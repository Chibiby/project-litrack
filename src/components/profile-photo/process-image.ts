/**
 * Browser-only avatar image pipeline: crop, downscale, and re-encode a picked
 * source photo into the 512×512 full and 128×128 thumbnail objects
 * `uploadOwnAvatar` expects. Runs entirely on the client.
 *
 * Nothing here is a security boundary — the server re-checks the produced
 * bytes (`validateAvatarUpload`) regardless of what this pipeline claims.
 * What it *is* responsible for: decoding through `<img>` so the browser
 * applies EXIF orientation, then re-encoding through `<canvas>`, which is
 * what strips EXIF/GPS metadata from the stored objects.
 *
 * Imported only from `crop-dialog.tsx`, which is itself lazy-loaded — never
 * import this from `profile-photo-card.tsx` as a value, or its `<canvas>`
 * work ships in the settings pages' first-load bundle.
 */

import {
  AVATAR_FULL_MAX_BYTES,
  AVATAR_FULL_SIZE,
  AVATAR_SOURCE_MAX_BYTES,
  AVATAR_THUMB_MAX_BYTES,
  AVATAR_THUMB_SIZE,
} from "@/lib/avatars/limits";
import {
  chooseOutputMime,
  clampCropRect,
  planDownscale,
  planQualitySteps,
  scaleCropRect,
  type CropRectPixels,
  type Dimensions,
} from "./encoding";

export type ProcessedAvatarImage = {
  full: File;
  thumb: File;
  mime: "image/webp" | "image/jpeg";
};

/** The raw file was refused before it was even decoded. */
export class AvatarSourceTooLargeError extends Error {
  constructor() {
    super("Source image exceeds the upload size ceiling.");
    this.name = "AvatarSourceTooLargeError";
  }
}

/** The browser could not decode the picked file as an image (e.g. HEIC). */
export class AvatarDecodeError extends Error {
  constructor(cause?: unknown) {
    super("Could not decode the picked file as an image.", { cause });
    this.name = "AvatarDecodeError";
  }
}

const DOWNSCALE_MAX_EDGE = 2048;
const WEBP_QUALITY = 0.8;
const JPEG_QUALITY = 0.85;

const EXT_BY_MIME: Record<"image/webp" | "image/jpeg", string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
};

function decodeImage(file: File): Promise<{ img: HTMLImageElement; url: string }> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  return img
    .decode()
    .then(() => ({ img, url }))
    .catch((err) => {
      URL.revokeObjectURL(url);
      throw new AvatarDecodeError(err);
    });
}

function requireContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarDecodeError(new Error("2D canvas context unavailable"));
  return ctx;
}

function downscaleToCanvas(img: HTMLImageElement, size: Dimensions): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  requireContext(canvas).drawImage(img, 0, 0, size.width, size.height);
  return canvas;
}

/**
 * Draws `crop` from `source` onto a fresh `outputSize`² canvas, white-filled
 * first — JPEG has no alpha channel, so a transparent PNG/WebP source must
 * not re-encode onto the canvas's default black background.
 */
function drawCropToSquareCanvas(
  source: CanvasImageSource,
  crop: CropRectPixels,
  outputSize: number
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = requireContext(canvas);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, outputSize, outputSize);
  ctx.drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, outputSize, outputSize);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new AvatarDecodeError(new Error("canvas.toBlob returned null")));
      },
      mime,
      quality
    );
  });
}

/**
 * Encodes `canvas` at `mime`, stepping quality down (`planQualitySteps`)
 * until the blob fits under `ceilingBytes`. If the whole plan is exhausted
 * without fitting, the smallest attempt is returned rather than failing the
 * crop outright — the server enforces the real ceiling regardless, and this
 * only ever runs when the starting quality already produced an oversize blob.
 */
async function encodeUnderCeiling(
  canvas: HTMLCanvasElement,
  mime: string,
  startQuality: number,
  ceilingBytes: number
): Promise<Blob> {
  let smallest: Blob | null = null;
  for (const quality of planQualitySteps(startQuality)) {
    const blob = await canvasToBlob(canvas, mime, quality);
    if (!smallest || blob.size < smallest.size) smallest = blob;
    if (blob.size <= ceilingBytes) return blob;
  }
  // eslint-disable-next-line no-console -- diagnostic only: reports that quality had to step down to fit the ceiling; the smallest attempt still ships and the server re-checks it.
  console.warn(
    `[avatar] ${mime} still over ${ceilingBytes}B after stepping quality down to the floor (smallest ${smallest?.size ?? 0}B)`
  );
  return smallest as Blob;
}

/**
 * Crop, downscale, and re-encode `source` into the full + thumbnail avatar
 * objects.
 *
 * `cropPixels` is the crop rect react-easy-crop measured against the
 * ORIGINAL decoded image (its `onCropComplete` pixel area) — downscaling
 * happens in here, so the rect is rescaled onto the downscaled working
 * canvas here rather than asking the dialog to know about that step.
 */
export async function processAvatarImage(
  source: File,
  cropPixels: CropRectPixels
): Promise<ProcessedAvatarImage> {
  if (source.size > AVATAR_SOURCE_MAX_BYTES) throw new AvatarSourceTooLargeError();

  const { img, url } = await decodeImage(source);
  try {
    const natural: Dimensions = { width: img.naturalWidth, height: img.naturalHeight };
    if (natural.width <= 0 || natural.height <= 0) {
      throw new AvatarDecodeError(new Error("decoded image has no pixels"));
    }

    const working = planDownscale(natural, DOWNSCALE_MAX_EDGE);
    const isDownscaled = working.width !== natural.width || working.height !== natural.height;
    const workingSource: CanvasImageSource = isDownscaled ? downscaleToCanvas(img, working) : img;
    const workingCrop = clampCropRect(scaleCropRect(cropPixels, natural, working), working);

    const fullCanvas = drawCropToSquareCanvas(workingSource, workingCrop, AVATAR_FULL_SIZE);
    const thumbCanvas = drawCropToSquareCanvas(
      fullCanvas,
      { x: 0, y: 0, width: AVATAR_FULL_SIZE, height: AVATAR_FULL_SIZE },
      AVATAR_THUMB_SIZE
    );

    let fullBlob = await canvasToBlob(fullCanvas, "image/webp", WEBP_QUALITY);
    const mime = chooseOutputMime(fullBlob.type);
    const quality = mime === "image/webp" ? WEBP_QUALITY : JPEG_QUALITY;

    if (mime !== "image/webp") {
      // The browser silently fell back instead of encoding WebP (old
      // Safari) — re-encode at the JPEG quality, the same target the
      // thumbnail below is about to use.
      fullBlob = await canvasToBlob(fullCanvas, mime, quality);
    }
    let thumbBlob = await canvasToBlob(thumbCanvas, mime, quality);

    if (fullBlob.size > AVATAR_FULL_MAX_BYTES) {
      fullBlob = await encodeUnderCeiling(fullCanvas, mime, quality, AVATAR_FULL_MAX_BYTES);
    }
    if (thumbBlob.size > AVATAR_THUMB_MAX_BYTES) {
      thumbBlob = await encodeUnderCeiling(thumbCanvas, mime, quality, AVATAR_THUMB_MAX_BYTES);
    }

    const ext = EXT_BY_MIME[mime];
    return {
      full: new File([fullBlob], `avatar-full.${ext}`, { type: mime }),
      thumb: new File([thumbBlob], `avatar-thumb.${ext}`, { type: mime }),
      mime,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
