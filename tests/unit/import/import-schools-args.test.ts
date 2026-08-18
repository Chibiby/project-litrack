import { describe, it, expect } from "vitest";
import { parseCliArgs } from "../../../scripts/import-schools";

describe("parseCliArgs", () => {
  it("is dry-run by default", () => {
    const o = parseCliArgs(["--file", "roster.xlsx"]);
    expect(o.commit).toBe(false);
    expect(o.wipe).toBe(false);
  });

  it("requires --file", () => {
    expect(() => parseCliArgs([])).toThrow(/--file/);
  });

  it("accepts --commit on its own as import-without-wipe", () => {
    const o = parseCliArgs(["--file", "r.xlsx", "--commit"]);
    expect(o.commit).toBe(true);
    expect(o.wipe).toBe(false);
  });

  it("refuses --wipe without the acknowledgement flag", () => {
    expect(() => parseCliArgs(["--file", "r.xlsx", "--commit", "--wipe"])).toThrow(
      /--i-understand-this-deletes-all-data/
    );
  });

  it("refuses the acknowledgement flag without --wipe", () => {
    expect(() => parseCliArgs(["--file", "r.xlsx", "--i-understand-this-deletes-all-data"])).toThrow(/--wipe/);
  });

  it("enables wiping only when both flags and --commit are present", () => {
    const o = parseCliArgs(["--file", "r.xlsx", "--commit", "--wipe", "--i-understand-this-deletes-all-data"]);
    expect(o.wipe).toBe(true);
    expect(o.commit).toBe(true);
  });

  it("reads --out and --allow-row-errors", () => {
    const o = parseCliArgs(["--file", "r.xlsx", "--out", "map.csv", "--allow-row-errors"]);
    expect(o.out).toBe("map.csv");
    expect(o.allowRowErrors).toBe(true);
  });
});
