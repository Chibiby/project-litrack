import { describe, expect, it } from "vitest";
import { districtAdminPassword, isStrongPasswordShape } from "@/lib/auth/credentials";

describe("districtAdminPassword", () => {
  it.each([
    ["Juan", "Cruz", "Juan.Cruz1234"],
    ["FERDINAND", "simon", "Ferdinand.Simon1234"],
    // First name keeps only its first word, so "Ma." loses its dot; last name
    // keeps every word, capitalised and joined.
    ["Ma. Theresa", "Dela Cruz", "Ma.DelaCruz1234"],
    ["Niño", "Peñaflor", "Nino.Penaflor1234"],
    ["  jose  ", "o'brien-reyes", "Jose.Obrienreyes1234"],
  ])("%s %s -> %s", (firstName, lastName, expected) => {
    const password = districtAdminPassword({ firstName, lastName });
    expect(password).toBe(expected);
    expect(isStrongPasswordShape(password)).toBe(true);
  });

  it("throws rather than produce '.1234' when a part has no letters", () => {
    expect(() => districtAdminPassword({ firstName: "", lastName: "" })).toThrow();
    expect(() => districtAdminPassword({ firstName: "Juan", lastName: "" })).toThrow();
    expect(() => districtAdminPassword({ firstName: "", lastName: "Cruz" })).toThrow();
    expect(() => districtAdminPassword({ firstName: "123", lastName: "Cruz" })).toThrow();
    expect(() => districtAdminPassword({ firstName: "Juan", lastName: "..." })).toThrow();
  });
});
