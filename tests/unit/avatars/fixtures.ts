/**
 * Minimal, hand-built JPEG/PNG/WebP byte buffers for the avatar unit tests.
 * Not a `.test.ts` file, so vitest does not run it directly — it only
 * supplies fixtures to `sniff.test.ts` and `validate-upload.test.ts`.
 *
 * No binary fixtures: every buffer is assembled field-by-field from the
 * format's own spec so the tests document exactly what bytes they exercise.
 */

function u16be(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff];
}

function u16le(n: number): number[] {
  return [n & 0xff, (n >> 8) & 0xff];
}

function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

function le24(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
}

function ascii(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0));
}

function bytes(...parts: number[][]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

/** Pads `data` to `size` bytes with zero bytes appended after it (never truncates). */
function padTo(data: Uint8Array, size?: number): Uint8Array {
  if (size === undefined || size <= data.length) return data;
  const out = new Uint8Array(size);
  out.set(data, 0);
  return out;
}

export type JpegOptions = {
  width?: number;
  height?: number;
  /** Adds an APP1 segment with the Exif signature. */
  exif?: boolean;
  /** Adds an APP1 segment carrying the Adobe XMP namespace. */
  xmp?: boolean;
  padToBytes?: number;
};

export function buildJpeg({
  width = 64,
  height = 64,
  exif = false,
  xmp = false,
  padToBytes,
}: JpegOptions = {}): Uint8Array {
  const soi = [0xff, 0xd8];

  let app1: number[] = [];
  if (exif) {
    const payload = [...ascii("Exif\0\0"), 0x4d, 0x4d, 0x00, 0x2a];
    app1 = [0xff, 0xe1, ...u16be(payload.length + 2), ...payload];
  } else if (xmp) {
    const payload = ascii("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>");
    app1 = [0xff, 0xe1, ...u16be(payload.length + 2), ...payload];
  }

  const sofPayload = [
    0x08, // precision
    ...u16be(height),
    ...u16be(width),
    0x01, // number of components
    0x01,
    0x22,
    0x00, // one component descriptor
  ];
  const sof = [0xff, 0xc0, ...u16be(sofPayload.length + 2), ...sofPayload];

  return padTo(bytes(soi, app1, sof), padToBytes);
}

export type PngOptions = {
  width?: number;
  height?: number;
  /** Adds an `eXIf` chunk. */
  eXIf?: boolean;
  /** Adds an `iTXt` chunk with the Adobe XMP keyword. */
  xmpItxt?: boolean;
  /** Adds an `acTL` chunk (APNG animation). */
  acTL?: boolean;
  padToBytes?: number;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngChunk(type: string, data: number[]): number[] {
  // CRC is never validated by the sniffer, so a fake trailer is fine.
  return [...u32be(data.length), ...ascii(type), ...data, 0x00, 0x00, 0x00, 0x00];
}

export function buildPng({
  width = 64,
  height = 64,
  eXIf = false,
  xmpItxt = false,
  acTL = false,
  padToBytes,
}: PngOptions = {}): Uint8Array {
  const ihdr = pngChunk("IHDR", [
    ...u32be(width),
    ...u32be(height),
    8, // bit depth
    6, // color type: RGBA
    0, // compression
    0, // filter
    0, // interlace
  ]);

  const chunks: number[] = [...ihdr];
  if (acTL) chunks.push(...pngChunk("acTL", [...u32be(1), ...u32be(0)]));
  if (eXIf) chunks.push(...pngChunk("eXIf", [0x00, 0x00, 0x00, 0x00]));
  if (xmpItxt) {
    const data = [
      ...ascii("XML:com.adobe.xmp"),
      0x00, // null terminator after keyword
      0x00, // compression flag
      0x00, // compression method
      0x00, // language tag terminator
      0x00, // translated keyword terminator
      ...ascii("<x:xmpmeta/>"),
    ];
    chunks.push(...pngChunk("iTXt", data));
  }
  chunks.push(...pngChunk("IEND", []));

  return padTo(bytes(PNG_SIGNATURE, chunks), padToBytes);
}

function riffChunk(fourCC: string, data: number[]): number[] {
  const pad = data.length % 2 === 1 ? [0x00] : [];
  return [...ascii(fourCC), ...u32le(data.length), ...data, ...pad];
}

function riffFile(payloadChunks: number[]): Uint8Array {
  const payload = [...ascii("WEBP"), ...payloadChunks];
  return bytes(ascii("RIFF"), u32le(payload.length), payload);
}

export function buildWebpVp8({
  width = 64,
  height = 64,
  padToBytes,
}: { width?: number; height?: number; padToBytes?: number } = {}): Uint8Array {
  const data = [
    0x10,
    0x00,
    0x00, // frame tag (irrelevant to the sniffer)
    0x9d,
    0x01,
    0x2a, // VP8 key-frame start code
    ...u16le(width),
    ...u16le(height),
  ];
  return padTo(riffFile(riffChunk("VP8 ", data)), padToBytes);
}

export function buildWebpVp8L({
  width = 64,
  height = 64,
  padToBytes,
}: { width?: number; height?: number; padToBytes?: number } = {}): Uint8Array {
  const widthMinus1 = width - 1;
  const heightMinus1 = height - 1;
  const bits = (widthMinus1 & 0x3fff) | ((heightMinus1 & 0x3fff) << 14);
  const data = [0x2f, ...u32le(bits >>> 0)];
  return padTo(riffFile(riffChunk("VP8L", data)), padToBytes);
}

export type Vp8xOptions = {
  width?: number;
  height?: number;
  exif?: boolean;
  xmp?: boolean;
  animated?: boolean;
  padToBytes?: number;
};

export function buildWebpVp8X({
  width = 64,
  height = 64,
  exif = false,
  xmp = false,
  animated = false,
  padToBytes,
}: Vp8xOptions = {}): Uint8Array {
  let flags = 0;
  if (exif) flags |= 0x08;
  if (xmp) flags |= 0x04;
  if (animated) flags |= 0x02;

  const data = [flags, 0x00, 0x00, 0x00, ...le24(width - 1), ...le24(height - 1)];
  return padTo(riffFile(riffChunk("VP8X", data)), padToBytes);
}

export function textBytes(text: string): Uint8Array {
  return Uint8Array.from(ascii(text));
}
