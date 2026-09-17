import { describe, expect, it } from "vitest";
import {
  FRESH_READ_WINDOW_SECONDS,
  isServerActionRequest,
  shouldReadFresh,
} from "@/lib/db/read-consistency";

const headersOf = (entries: Record<string, string>) => (name: string) =>
  entries[name] ?? null;

describe("isServerActionRequest", () => {
  it("is true for a POST carrying the Next-Action header", () => {
    expect(isServerActionRequest("POST", headersOf({ "next-action": "abc123" }))).toBe(true);
  });

  it("is false for a POST without the header", () => {
    expect(isServerActionRequest("POST", headersOf({}))).toBe(false);
  });

  it("is false for a GET, even with the header", () => {
    expect(isServerActionRequest("GET", headersOf({ "next-action": "abc123" }))).toBe(false);
  });
});

describe("shouldReadFresh", () => {
  it("reads cached when the browser has not written", () => {
    expect(shouldReadFresh({ isServerAction: false, hasFreshCookie: false })).toBe(false);
  });

  it("reads fresh inside a Server Action", () => {
    expect(shouldReadFresh({ isServerAction: true, hasFreshCookie: false })).toBe(true);
  });

  it("reads fresh within the window after a write", () => {
    expect(shouldReadFresh({ isServerAction: false, hasFreshCookie: true })).toBe(true);
  });
});

describe("FRESH_READ_WINDOW_SECONDS", () => {
  it("outlasts Hyperdrive's 60s max age plus 15s stale-while-revalidate", () => {
    expect(FRESH_READ_WINDOW_SECONDS).toBeGreaterThan(75);
  });
});
