import { afterEach, describe, expect, it } from "vitest";
import { CANONICAL_APP_URL, canonicalAppUrl } from "@/lib/app-url";

const saved = process.env.NEXT_PUBLIC_APP_URL;

afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = saved;
});

describe("canonicalAppUrl", () => {
  it("uses NEXT_PUBLIC_APP_URL when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://litrack.example.org";
    expect(canonicalAppUrl()).toBe("https://litrack.example.org");
  });

  it("trims whitespace and all trailing slashes", () => {
    process.env.NEXT_PUBLIC_APP_URL = "  https://litrack.example.org///  ";
    expect(canonicalAppUrl()).toBe("https://litrack.example.org");
  });

  it("falls back to https://arallitrack.com when unset or blank", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(canonicalAppUrl()).toBe("https://arallitrack.com");
    process.env.NEXT_PUBLIC_APP_URL = "   ";
    expect(canonicalAppUrl()).toBe(CANONICAL_APP_URL);
  });
});
