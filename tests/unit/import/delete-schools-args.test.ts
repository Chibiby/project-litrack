import { describe, it, expect } from "vitest";
import { parseDeleteCliArgs } from "../../../scripts/delete-schools";

describe("parseDeleteCliArgs", () => {
  it("is dry-run by default", () => {
    const o = parseDeleteCliArgs(["--school", "305402"]);
    expect(o.commit).toBe(false);
    expect(o.schools).toEqual(["305402"]);
  });

  it("requires at least one --school", () => {
    expect(() => parseDeleteCliArgs([])).toThrow(/--school/);
    expect(() => parseDeleteCliArgs(["--commit"])).toThrow(/--school/);
  });

  it("collects a repeated --school in order", () => {
    const o = parseDeleteCliArgs(["--school", "305402", "--school", "Some School Name"]);
    expect(o.schools).toEqual(["305402", "Some School Name"]);
  });

  it("enables deletion only with --commit", () => {
    const o = parseDeleteCliArgs(["--school", "305402", "--commit"]);
    expect(o.commit).toBe(true);
  });

  it("rejects a --school with no value", () => {
    expect(() => parseDeleteCliArgs(["--school"])).toThrow(/needs a School ID or name/);
    // A following flag is not a school name, however much it looks like an argument.
    expect(() => parseDeleteCliArgs(["--school", "--commit"])).toThrow(/needs a School ID or name/);
  });

  it("rejects the same school twice, case-insensitively", () => {
    expect(() => parseDeleteCliArgs(["--school", "Abc School", "--school", "abc school"])).toThrow(
      /twice/
    );
  });

  it("does not treat a school name that starts with a digit as a flag", () => {
    // Regression guard: the flag check must be `startsWith("--")`, not a general
    // "looks like an option" heuristic. DepEd School IDs are bare numbers.
    const o = parseDeleteCliArgs(["--school", "500282", "--commit"]);
    expect(o.schools).toEqual(["500282"]);
    expect(o.commit).toBe(true);
  });
});
