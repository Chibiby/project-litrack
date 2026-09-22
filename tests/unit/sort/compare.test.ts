import { describe, expect, it } from "vitest";
import { compareNames } from "@/lib/sort/compare";

describe("compareNames", () => {
  it("orders accented and mixed-case names the way a human expects", () => {
    const names = ["ñeri", "Zamora", "Angeles", "acosta"];
    expect([...names].sort(compareNames)).toEqual(["acosta", "Angeles", "ñeri", "Zamora"]);
  });

  it("is stable across repeated sorts of the same input", () => {
    const names = ["Bea", "bea", "Ana"];
    const first = [...names].sort(compareNames);
    const second = [...names].sort(compareNames);
    expect(second).toEqual(first);
  });

  it("treats accented and unaccented forms of the same name as equal, per sensitivity: 'base'", () => {
    expect(compareNames("Ñuñez", "Nunez")).toBe(0);
  });
});
