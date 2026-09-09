import { describe, expect, it } from "vitest";
import {
  adminLoginSchema,
  schoolLoginSchema,
  teacherLoginSchema,
  teacherRegisterSchema,
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

describe("teacherRegisterSchema", () => {
  it("requires names, strong password, and matching confirm", () => {
    expect(teacherRegisterSchema.safeParse(validRegisterBase).success).toBe(true);

    expect(
      teacherRegisterSchema.safeParse({
        ...validRegisterBase,
        firstName: "",
        lastName: "",
      }).success
    ).toBe(false);

    expect(
      teacherRegisterSchema.safeParse({
        ...validRegisterBase,
        confirmPassword: "password2",
      }).success
    ).toBe(false);

    expect(
      teacherRegisterSchema.safeParse({
        ...validRegisterBase,
        password: "short",
        confirmPassword: "short",
      }).success
    ).toBe(false);
  });

  it("defaults isAralVolunteer to false when the box is left unticked", () => {
    // An unticked checkbox posts no field at all. Absence must read as "no",
    // never as a validation failure that blocks the registration.
    const parsed = teacherRegisterSchema.safeParse(validRegisterBase);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.isAralVolunteer).toBe(false);
  });

  it("carries a ticked isAralVolunteer through", () => {
    const parsed = teacherRegisterSchema.safeParse({
      ...validRegisterBase,
      isAralVolunteer: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.isAralVolunteer).toBe(true);
  });

  it("needs no verification code — School Head approval is the gate", () => {
    expect(teacherRegisterSchema.safeParse({ ...validRegisterBase, code: "123456" }).success).toBe(
      true
    );
    expect(teacherRegisterSchema.safeParse({ ...validRegisterBase, schoolId: "" }).success).toBe(
      false
    );
  });
});

describe("adminLoginSchema", () => {
  it("canonicalises the username to the lower-case form stored on the row", () => {
    const parsed = adminLoginSchema.safeParse({ username: "  ADMIN  ", password: "s3cret" });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.username).toBe("admin");
  });

  it("rejects a username that is empty or only whitespace", () => {
    expect(adminLoginSchema.safeParse({ username: "", password: "s3cret" }).success).toBe(false);
    expect(adminLoginSchema.safeParse({ username: "   ", password: "s3cret" }).success).toBe(false);
  });

  it("requires a password", () => {
    expect(adminLoginSchema.safeParse({ username: "admin", password: "" }).success).toBe(false);
  });

  it("accepts a handle that is not an email address", () => {
    expect(adminLoginSchema.safeParse({ username: "admin", password: "s3cret" }).success).toBe(
      true
    );
  });
});
