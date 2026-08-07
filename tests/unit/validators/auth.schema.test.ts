import { describe, expect, it } from "vitest";
import {
  schoolLoginSchema,
  setPasswordSchema,
  changePasswordSchema,
  strongPassword,
  requestTeacherOtpSchema,
  verifyTeacherOtpSchema,
} from "@/lib/validators/auth.schema";

describe("strongPassword", () => {
  it("requires letter and number and min length 8", () => {
    expect(strongPassword.safeParse("short1").success).toBe(false);
    expect(strongPassword.safeParse("longenough").success).toBe(false);
    expect(strongPassword.safeParse("12345678").success).toBe(false);
    expect(strongPassword.safeParse("password1").success).toBe(true);
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

describe("requestTeacherOtpSchema / verifyTeacherOtpSchema", () => {
  it("requires names on register", () => {
    expect(
      requestTeacherOtpSchema.safeParse({
        schoolId: "s1",
        email: "a@example.com",
        intent: "register",
      }).success
    ).toBe(false);

    expect(
      requestTeacherOtpSchema.safeParse({
        schoolId: "s1",
        email: "a@example.com",
        intent: "register",
        firstName: "Ada",
        lastName: "Lovelace",
      }).success
    ).toBe(true);
  });

  it("requires a 6-digit code on verify", () => {
    expect(
      verifyTeacherOtpSchema.safeParse({
        schoolId: "s1",
        email: "a@example.com",
        intent: "login",
        code: "12345",
      }).success
    ).toBe(false);

    expect(
      verifyTeacherOtpSchema.safeParse({
        schoolId: "s1",
        email: "a@example.com",
        intent: "login",
        code: "123456",
      }).success
    ).toBe(true);
  });
});
