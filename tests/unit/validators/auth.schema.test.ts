import { describe, expect, it } from "vitest";
import {
  schoolLoginSchema,
  teacherLoginSchema,
  requestTeacherRegisterOtpSchema,
  verifyTeacherRegisterOtpSchema,
  setPasswordSchema,
  changePasswordSchema,
  strongPassword,
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
  it("accepts SCHOOL_HEAD only and rejects TEACHER / others", () => {
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
      }).success
    ).toBe(false);

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
  it("requires schoolId, email, and password", () => {
    expect(
      teacherLoginSchema.safeParse({
        schoolId: "school-1",
        email: "t@example.com",
        password: "secret",
      }).success
    ).toBe(true);

    expect(
      teacherLoginSchema.safeParse({
        schoolId: "",
        email: "t@example.com",
        password: "secret",
      }).success
    ).toBe(false);

    expect(
      teacherLoginSchema.safeParse({
        schoolId: "school-1",
        email: "not-an-email",
        password: "secret",
      }).success
    ).toBe(false);

    expect(
      teacherLoginSchema.safeParse({
        schoolId: "school-1",
        email: "t@example.com",
        password: "",
      }).success
    ).toBe(false);
  });
});

const validRegisterBase = {
  schoolId: "s1",
  email: "a@example.com",
  firstName: "Ada",
  lastName: "Lovelace",
  password: "password1",
  confirmPassword: "password1",
};

describe("requestTeacherRegisterOtpSchema", () => {
  it("requires names, strong password, and matching confirm", () => {
    expect(requestTeacherRegisterOtpSchema.safeParse(validRegisterBase).success).toBe(true);

    expect(
      requestTeacherRegisterOtpSchema.safeParse({
        ...validRegisterBase,
        firstName: "",
        lastName: "",
      }).success
    ).toBe(false);

    expect(
      requestTeacherRegisterOtpSchema.safeParse({
        ...validRegisterBase,
        confirmPassword: "password2",
      }).success
    ).toBe(false);

    expect(
      requestTeacherRegisterOtpSchema.safeParse({
        ...validRegisterBase,
        password: "short",
        confirmPassword: "short",
      }).success
    ).toBe(false);
  });
});

describe("verifyTeacherRegisterOtpSchema", () => {
  it("requires names, matching passwords, and a 6-digit code", () => {
    expect(
      verifyTeacherRegisterOtpSchema.safeParse({
        ...validRegisterBase,
        code: "123456",
      }).success
    ).toBe(true);

    expect(
      verifyTeacherRegisterOtpSchema.safeParse({
        ...validRegisterBase,
        code: "12345",
      }).success
    ).toBe(false);

    expect(
      verifyTeacherRegisterOtpSchema.safeParse({
        ...validRegisterBase,
        code: "abcdef",
      }).success
    ).toBe(false);

    expect(
      verifyTeacherRegisterOtpSchema.safeParse({
        ...validRegisterBase,
        firstName: "",
        code: "123456",
      }).success
    ).toBe(false);

    expect(
      verifyTeacherRegisterOtpSchema.safeParse({
        ...validRegisterBase,
        confirmPassword: "password2",
        code: "123456",
      }).success
    ).toBe(false);
  });
});
