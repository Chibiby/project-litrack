/**
 * Magic-byte sniffing for avatar uploads: JPEG, PNG, and WebP only.
 *
 * Client MIME types are never trusted (the design doc says so directly), so
 * this reads the actual bytes to recover dimensions, whether the file
 * carries EXIF/XMP metadata, and whether it is animated. Every read is
 * bounds-checked against the buffer length; this function is never allowed
 * to throw, even on truncated or adversarial input — it returns null
 * instead. Pure, no `server-only`.
 */

export type AvatarMime = "image/jpeg" | "image/png" | "image/webp";

export type SniffResult = {
  mime: AvatarMime;
  width: number;
  height: number;
  hasMetadata: boolean;
  animated: boolean;
};

export function sniffImage(bytes: Uint8Array): SniffResult | null {
  try {
    if (!bytes || bytes.length < 12) return null;
    if (isJpeg(bytes)) return sniffJpeg(bytes);
    if (isPng(bytes)) return sniffPng(bytes);
    if (isWebp(bytes)) return sniffWebp(bytes);
    return null;
  } catch {
    // Belt and suspenders: every branch below is bounds-checked, but a
    // sniffer must never be the thing that crashes a request.
    return null;
  }
}

// ── Shared byte helpers ─────────────────────────────────────────────────

function readUint16BE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint24LE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 3 > bytes.length) return null;
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function readUint32BE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (
    bytes[offset] * 0x1000000 +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

function asciiSlice(bytes: Uint8Array, start: number, length: number): string {
  const end = Math.min(start + length, bytes.length);
  let out = "";
  for (let i = Math.max(start, 0); i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function startsWithAscii(bytes: Uint8Array, text: string): boolean {
  return asciiSlice(bytes, 0, text.length) === text;
}

function containsAscii(bytes: Uint8Array, text: string): boolean {
  return asciiSlice(bytes, 0, bytes.length).includes(text);
}

// ── JPEG ─────────────────────────────────────────────────────────────────

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/**
 * Walks JFIF markers to the first SOF0/SOF1/SOF2 for dimensions, and tracks
 * whether any APP1 segment carries an Exif signature or the Adobe XMP
 * namespace along the way.
 */
function sniffJpeg(bytes: Uint8Array): SniffResult | null {
  const len = bytes.length;
  let offset = 2; // past the SOI marker (0xFFD8)
  let hasMetadata = false;

  while (offset < len) {
    if (bytes[offset] !== 0xff) return null;

    let cursor = offset + 1;
    if (cursor >= len) return null;
    while (bytes[cursor] === 0xff) {
      cursor += 1;
      if (cursor >= len) return null;
    }
    const marker = bytes[cursor];
    offset = cursor + 1;

    // Markers with no length field: TEM (0x01), RSTn (0xD0-0xD7), SOI/EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      if (marker === 0xd9) return null; // EOI without a SOF: not a valid still.
      continue;
    }

    const segmentLength = readUint16BE(bytes, offset);
    if (segmentLength === null || segmentLength < 2) return null;
    const payloadStart = offset + 2;
    const payloadEnd = offset + segmentLength;
    if (payloadEnd > len) return null;

    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      // SOF0/1/2 payload: precision(1) height(2) width(2) ...
      const height = readUint16BE(bytes, payloadStart + 1);
      const width = readUint16BE(bytes, payloadStart + 3);
      if (height === null || width === null) return null;
      return { mime: "image/jpeg", width, height, hasMetadata, animated: false };
    }

    if (marker === 0xe1) {
      const segment = bytes.subarray(payloadStart, payloadEnd);
      if (
        startsWithAscii(segment, "Exif\0\0") ||
        containsAscii(segment, "ns.adobe.com/xap/1.0/")
      ) {
        hasMetadata = true;
      }
    }

    offset = payloadEnd;
  }

  return null; // ran off the end without finding a SOF marker
}

// ── PNG ──────────────────────────────────────────────────────────────────

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

/**
 * Walks PNG chunks for IHDR dimensions, `eXIf`/Adobe-XMP `iTXt` metadata,
 * and an `acTL` chunk (APNG animation).
 */
function sniffPng(bytes: Uint8Array): SniffResult | null {
  const len = bytes.length;
  let offset = 8;
  let width: number | null = null;
  let height: number | null = null;
  let hasMetadata = false;
  let animated = false;

  while (offset + 8 <= len) {
    const chunkLength = readUint32BE(bytes, offset);
    if (chunkLength === null) return null;
    const type = asciiSlice(bytes, offset + 4, 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    if (dataEnd + 4 > len) return null; // data + trailing CRC must fit

    if (type === "IHDR") {
      if (chunkLength < 8) return null;
      const w = readUint32BE(bytes, dataStart);
      const h = readUint32BE(bytes, dataStart + 4);
      if (w === null || h === null) return null;
      width = w;
      height = h;
    } else if (type === "eXIf") {
      hasMetadata = true;
    } else if (type === "iTXt") {
      const data = bytes.subarray(dataStart, dataEnd);
      if (containsAscii(data, "XML:com.adobe.xmp")) hasMetadata = true;
    } else if (type === "acTL") {
      animated = true;
    } else if (type === "IEND") {
      break;
    }

    offset = dataEnd + 4; // skip the CRC
  }

  if (width === null || height === null) return null;
  return { mime: "image/png", width, height, hasMetadata, animated };
}

// ── WebP ─────────────────────────────────────────────────────────────────

function isWebp(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return asciiSlice(bytes, 0, 4) === "RIFF" && asciiSlice(bytes, 8, 4) === "WEBP";
}

/**
 * Walks RIFF chunks for VP8 (lossy), VP8L (lossless), or VP8X (extended)
 * dimensions. Metadata and animation are read only from the VP8X flags
 * byte, per the container spec: a simple (non-extended) bitstream cannot
 * carry EXIF/XMP/ANIM chunks at all.
 */
function sniffWebp(bytes: Uint8Array): SniffResult | null {
  const len = bytes.length;
  let offset = 12;
  let width: number | null = null;
  let height: number | null = null;
  let hasMetadata = false;
  let animated = false;

  while (offset + 8 <= len) {
    const fourCC = asciiSlice(bytes, offset, 4);
    const chunkSize = readUint32LE(bytes, offset + 4);
    if (chunkSize === null) return null;
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (dataEnd > len) return null;

    if (fourCC === "VP8X") {
      if (chunkSize < 10) return null;
      const flags = bytes[dataStart];
      if (flags & 0x08) hasMetadata = true; // EXIF
      if (flags & 0x04) hasMetadata = true; // XMP
      if (flags & 0x02) animated = true; // ANIM
      const w24 = readUint24LE(bytes, dataStart + 4);
      const h24 = readUint24LE(bytes, dataStart + 7);
      if (w24 === null || h24 === null) return null;
      width = w24 + 1;
      height = h24 + 1;
    } else if (fourCC === "VP8 " && width === null) {
      if (chunkSize < 10) return null;
      // 3-byte frame tag, then the start code 0x9d 0x01 0x2a.
      if (
        bytes[dataStart + 3] !== 0x9d ||
        bytes[dataStart + 4] !== 0x01 ||
        bytes[dataStart + 5] !== 0x2a
      ) {
        return null;
      }
      const w16 = readUint16LE(bytes, dataStart + 6);
      const h16 = readUint16LE(bytes, dataStart + 8);
      if (w16 === null || h16 === null) return null;
      width = w16 & 0x3fff;
      height = h16 & 0x3fff;
    } else if (fourCC === "VP8L" && width === null) {
      if (chunkSize < 5) return null;
      if (bytes[dataStart] !== 0x2f) return null; // VP8L signature
      const bits = readUint32LE(bytes, dataStart + 1);
      if (bits === null) return null;
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }

    offset = dataEnd + (chunkSize % 2); // RIFF chunks pad to an even size
  }

  if (width === null || height === null) return null;
  return { mime: "image/webp", width, height, hasMetadata, animated };
}

function readUint16LE(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;
  return bytes[offset] | (bytes[offset + 1] << 8);
}
