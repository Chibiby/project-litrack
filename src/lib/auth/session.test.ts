import { describe, expect, it } from "vitest";
import { isSuperAdmin, roleHomePath } from "./roles";
import type { User } from "@prisma/client";

function baseUser(overrides: Partial<User> = {}): User {
  return {
    id: "u1",
    authId: "a1",
    email: "t@school.local",
    role: "TEACHER",
    schoolId: "s1",
    firstName: "T",
    middleName: null,
    lastName: "Eacher",
    fullName: "T Eacher",
    isActive: true,
    profileCompleted: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

describe("roleHomePath", () => {
  it("maps each role to its home path", () => {
    expect(roleHomePath("SUPER_ADMIN")).toBe("/admin");
    expect(roleHomePath("SCHOOL_HEAD")).toBe("/school-head");
    expect(roleHomePath("TEACHER")).toBe("/teacher");
  });
});

describe("isSuperAdmin", () => {
  it("returns true only for SUPER_ADMIN", () => {
    expect(isSuperAdmin(baseUser({ role: "SUPER_ADMIN" }))).toBe(true);
    expect(isSuperAdmin(baseUser({ role: "SCHOOL_HEAD" }))).toBe(false);
    expect(isSuperAdmin(baseUser({ role: "TEACHER" }))).toBe(false);
  });
});
