import { describe, expect, it } from "vitest";
import {
  AUTO_APPROVE_MAX_MS,
  autoApproveState,
  isWithinAutoApproveWindow,
  parseAutoApproveWindow,
  serializeAutoApproveWindow,
  validateAutoApproveWindow,
} from "@/lib/teachers/auto-approve";

const start = new Date("2026-11-20T00:00:00.000Z");
const end = new Date("2026-11-21T00:00:00.000Z");
const window = { start, end };

describe("parseAutoApproveWindow", () => {
  it("round-trips a serialized window", () => {
    expect(parseAutoApproveWindow(serializeAutoApproveWindow(window))).toEqual(window);
  });

  it.each([null, "", "not json", "{}", '{"start":"x","end":"y"}', "[]"])(
    "reads %j as no window",
    (raw) => {
      expect(parseAutoApproveWindow(raw)).toBeNull();
    }
  );

  it("reads an end before the start as no window", () => {
    expect(
      parseAutoApproveWindow(JSON.stringify({ start: end.toISOString(), end: start.toISOString() }))
    ).toBeNull();
  });
});

describe("isWithinAutoApproveWindow", () => {
  it("is false with no window", () => {
    expect(isWithinAutoApproveWindow(null, start)).toBe(false);
  });

  it("includes the start and excludes the end", () => {
    expect(isWithinAutoApproveWindow(window, new Date(start.getTime() - 1))).toBe(false);
    expect(isWithinAutoApproveWindow(window, start)).toBe(true);
    expect(isWithinAutoApproveWindow(window, new Date(end.getTime() - 1))).toBe(true);
    expect(isWithinAutoApproveWindow(window, end)).toBe(false);
  });
});

describe("autoApproveState", () => {
  it("names each phase", () => {
    expect(autoApproveState(null, start)).toBe("off");
    expect(autoApproveState(window, new Date(start.getTime() - 1))).toBe("scheduled");
    expect(autoApproveState(window, start)).toBe("open");
    expect(autoApproveState(window, end)).toBe("ended");
  });
});

describe("validateAutoApproveWindow", () => {
  const now = new Date("2026-11-19T00:00:00.000Z");

  it("accepts a future window", () => {
    expect(validateAutoApproveWindow(window, now)).toBeNull();
  });

  it("refuses an end that has passed", () => {
    expect(validateAutoApproveWindow(window, new Date(end.getTime() + 1))).toMatch(/passed/);
  });

  it("refuses an end before the start", () => {
    expect(validateAutoApproveWindow({ start: end, end: start }, now)).toMatch(/after the start/);
  });

  it("refuses a window longer than the maximum", () => {
    const long = { start, end: new Date(start.getTime() + AUTO_APPROVE_MAX_MS + 1) };
    expect(validateAutoApproveWindow(long, now)).toMatch(/at most/);
  });
});
