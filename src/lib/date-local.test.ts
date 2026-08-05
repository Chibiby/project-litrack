import { describe, expect, it } from "vitest";
import { formatLocalDateYmd, parseLocalDateYmd } from "./date-local";

describe("parseLocalDateYmd", () => {
  it("parses as local midnight (not UTC)", () => {
    const d = parseLocalDateYmd("2024-06-15");
    expect(d.getFullYear()).toBe(2024);
    expect(d.getMonth()).toBe(5);
    expect(d.getDate()).toBe(15);
    expect(d.getHours()).toBe(0);
  });

  it("rejects invalid strings", () => {
    expect(() => parseLocalDateYmd("2024/06/15")).toThrow();
  });
});

describe("formatLocalDateYmd", () => {
  it("round-trips with parseLocalDateYmd", () => {
    const ymd = "2024-01-09";
    expect(formatLocalDateYmd(parseLocalDateYmd(ymd))).toBe(ymd);
  });
});
