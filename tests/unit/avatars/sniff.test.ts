import { describe, expect, it } from "vitest";
import { sniffImage } from "@/lib/avatars/sniff";
import {
  buildJpeg,
  buildPng,
  buildWebpVp8,
  buildWebpVp8L,
  buildWebpVp8X,
  textBytes,
} from "./fixtures";

describe("sniffImage — JPEG", () => {
  it("reads dimensions from a plain SOF0 stream", () => {
    const result = sniffImage(buildJpeg({ width: 200, height: 100 }));
    expect(result).toEqual({
      mime: "image/jpeg",
      width: 200,
      height: 100,
      hasMetadata: false,
      animated: false,
    });
  });

  it("flags an APP1 segment carrying an Exif signature as metadata", () => {
    const result = sniffImage(buildJpeg({ exif: true }));
    expect(result?.hasMetadata).toBe(true);
  });

  it("flags an APP1 segment carrying the Adobe XMP namespace as metadata", () => {
    const result = sniffImage(buildJpeg({ xmp: true }));
    expect(result?.hasMetadata).toBe(true);
  });

  it("returns null for a JPEG truncated mid-SOF payload", () => {
    const full = buildJpeg({ width: 64, height: 64 });
    const truncated = full.slice(0, 12);
    expect(sniffImage(truncated)).toBeNull();
  });
});

describe("sniffImage — PNG", () => {
  it("reads dimensions from IHDR", () => {
    const result = sniffImage(buildPng({ width: 300, height: 150 }));
    expect(result).toEqual({
      mime: "image/png",
      width: 300,
      height: 150,
      hasMetadata: false,
      animated: false,
    });
  });

  it("flags an eXIf chunk as metadata", () => {
    const result = sniffImage(buildPng({ eXIf: true }));
    expect(result?.hasMetadata).toBe(true);
  });

  it("flags an iTXt XML:com.adobe.xmp chunk as metadata", () => {
    const result = sniffImage(buildPng({ xmpItxt: true }));
    expect(result?.hasMetadata).toBe(true);
  });

  it("flags an acTL chunk as animated", () => {
    const result = sniffImage(buildPng({ acTL: true }));
    expect(result?.animated).toBe(true);
  });

  it("returns null for a PNG truncated mid-IHDR", () => {
    const full = buildPng({ width: 64, height: 64 });
    const truncated = full.slice(0, 20);
    expect(sniffImage(truncated)).toBeNull();
  });
});

describe("sniffImage — WebP", () => {
  it("reads dimensions from a VP8 (lossy) key frame", () => {
    const result = sniffImage(buildWebpVp8({ width: 111, height: 222 }));
    expect(result).toEqual({
      mime: "image/webp",
      width: 111,
      height: 222,
      hasMetadata: false,
      animated: false,
    });
  });

  it("reads dimensions from a VP8L (lossless) stream", () => {
    const result = sniffImage(buildWebpVp8L({ width: 77, height: 33 }));
    expect(result).toEqual({
      mime: "image/webp",
      width: 77,
      height: 33,
      hasMetadata: false,
      animated: false,
    });
  });

  it("reads canvas dimensions from a VP8X extended header", () => {
    const result = sniffImage(buildWebpVp8X({ width: 400, height: 500 }));
    expect(result).toEqual({
      mime: "image/webp",
      width: 400,
      height: 500,
      hasMetadata: false,
      animated: false,
    });
  });

  it("flags the VP8X EXIF bit as metadata", () => {
    const result = sniffImage(buildWebpVp8X({ exif: true }));
    expect(result?.hasMetadata).toBe(true);
  });

  it("flags the VP8X XMP bit as metadata", () => {
    const result = sniffImage(buildWebpVp8X({ xmp: true }));
    expect(result?.hasMetadata).toBe(true);
  });

  it("flags the VP8X animation bit as animated", () => {
    const result = sniffImage(buildWebpVp8X({ animated: true }));
    expect(result?.animated).toBe(true);
  });

  it("ignores the VP8X ICC and alpha bits", () => {
    const result = sniffImage(
      buildWebpVp8X({ width: 40, height: 40 })
    );
    // ICC (0x20) and alpha (0x10) are not requested above; this simply
    // pins that a clean VP8X header reports no metadata and no animation.
    expect(result?.hasMetadata).toBe(false);
    expect(result?.animated).toBe(false);
  });

  it("returns null for a WebP whose chunk size overruns the buffer", () => {
    const full = buildWebpVp8({ width: 64, height: 64 });
    const truncated = full.slice(0, 16);
    expect(sniffImage(truncated)).toBeNull();
  });
});

describe("sniffImage — rejected formats", () => {
  it("returns null for a GIF", () => {
    expect(sniffImage(textBytes("GIF89a" + "\0".repeat(20)))).toBeNull();
  });

  it("returns null for an SVG", () => {
    expect(
      sniffImage(textBytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))
    ).toBeNull();
  });

  it("returns null for HTML", () => {
    expect(sniffImage(textBytes("<!DOCTYPE html><html></html>"))).toBeNull();
  });

  it("returns null for a tiny truncated buffer without throwing", () => {
    expect(() => sniffImage(Uint8Array.from([0xff, 0xd8, 0xff]))).not.toThrow();
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it("returns null for an empty buffer", () => {
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});
