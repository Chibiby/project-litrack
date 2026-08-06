import { describe, expect, it } from "vitest";
import {
  schoolLoginSchema,
  teacherSetupSchema,
  teacherLoginSchema,
  setPasswordSchema,
  changePasswordSchema,
  strongPassword,
} from "@/lib/validators/auth.schema";
import { teacherInviteSchema } from "@/lib/validators/teacher-invite.schema";

describe("strongPassword", () => {
  it("requires letter and number and min length 8", () => {
    expect(strongPassword.safeParse("short1").success).toBe(false);
    expect(strongPassword.safeParse("longenough").success).toBe(false);
    expect(strongPassword.safeParse("12345678").success).toBe(false);
    expect(strongPassword.safeParse("password1").success).toBe(true);
  });
});

describe("teacherSetupSchema", () => {
  it("requires password min length 8, letter+number, and matching confirmPassword", () => {
    expect(
      teacherSetupSchema.safeParse({
        token: "tok",
        password: "short",
        confirmPassword: "short",
      }).success
    ).toBe(false);

    expect(
      teacherSetupSchema.safeParse({
        token: "tok",
        password: "longenough",
        confirmPassword: "longenough",
      }).success
    ).toBe(false);

    const mismatch = teacherSetupSchema.safeParse({
      token: "tok",
      password: "password1",
      confirmPassword: "password2",
    });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) {
      expect(mismatch.error.issues.some((i) => i.path.includes("confirmPassword"))).toBe(true);
    }

    expect(
      teacherSetupSchema.safeParse({
        token: "tok",
        password: "password1",
        confirmPassword: "password1",
      }).success
    ).toBe(true);
  });
});

describe("setPasswordSchema / changePasswordSchema", () => {
  it("validates set password confirm match", () => {
    expect(
      setPasswordSchema.safeParse({ password: "password1", confirmPassword: "password1" }).success
    ).toBe(true);
    expect(
      setPasswordSchema.safeParse({ password: "password1", confirmPassword: "password2" }).success
    ).toBe(false);
  });

  it("requires current password and different new password", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "oldpass1",
        password: "oldpass1",
        confirmPassword: "oldpass1",
      }).success
    ).toBe(false);

    expect(
      changePasswordSchema.safeParse({
        currentPassword: "oldpass1",
        password: "newpass2",
        confirmPassword: "newpass2",
      }).success
    ).toBe(true);
  });
});

describe("schoolLoginSchema", () => {
  it("accepts SCHOOL_HEAD and TEACHER roles and rejects others", () => {
    expect(
      schoolLoginSchema.safeParse({
        schoolId: "school-1",
        role: "SCHOOL_HEAD",
        password: "secret",
      }).success
    ).toBe(true);

    expect(
      schoolLoginSchema.safeParse({
        schoolId: "school-1",
        role: "TEACHER",
        password: "secret",
        teacherEmail: "t@example.com",
      }).success
    ).toBe(true);

    expect(
      schoolLoginSchema.safeParse({
        schoolId: "school-1",
        role: "SUPER_ADMIN",
        password: "secret",
      }).success
    ).toBe(false);
  });
});

describe("teacherLoginSchema", () => {
  it("requires school, username, password", () => {
    expect(
      teacherLoginSchema.safeParse({
        schoolId: "s1",
        username: "teacher.smith.a1b2",
        password: "x",
      }).success
    ).toBe(true);
    expect(teacherLoginSchema.safeParse({ schoolId: "s1", username: "", password: "x" }).success).toBe(
      false
    );
  });
});

describe("teacherInviteSchema", () => {
  it("requires names and grade; email optional", () => {
    expect(
      teacherInviteSchema.safeParse({
        gradeLevelId: "g1",
        firstName: "Ada",
        lastName: "Lovelace",
      }).success
    ).toBe(true);

    expect(
      teacherInviteSchema.safeParse({
        gradeLevelId: "g1",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "",
      }).success
    ).toBe(true);

    expect(
      teacherInviteSchema.safeParse({
        gradeLevelId: "g1",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
      }).success
    ).toBe(true);

    expect(
      teacherInviteSchema.safeParse({
        gradeLevelId: "g1",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "not-an-email",
      }).success
    ).toBe(false);
  });
});
