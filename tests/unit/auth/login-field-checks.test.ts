import { describe, expect, it } from "vitest";
import {
  LOGIN_CHECK_MESSAGES as M,
  checkSchoolHeadLogin,
  checkTeacherLogin,
  checkTeacherRegister,
  firstLoginFieldError,
} from "@/lib/auth/login-field-checks";

describe("checkTeacherLogin", () => {
  it("names each empty field", () => {
    expect(checkTeacherLogin({ email: "", password: "" })).toEqual({
      email: M.emailMissing,
      password: M.passwordMissing,
    });
  });

  it("explains an email with no @ instead of a browser pop-up", () => {
    expect(checkTeacherLogin({ email: "asd", password: "x" })).toEqual({ email: M.emailInvalid });
  });

  it("passes a complete sign-in, ignoring spaces around the email", () => {
    expect(checkTeacherLogin({ email: "  t@school.edu ", password: "x" })).toEqual({});
  });
});

describe("checkSchoolHeadLogin", () => {
  it("asks for the School ID or password only when empty", () => {
    expect(checkSchoolHeadLogin({ password: "" })).toEqual({ password: M.schoolIdMissing });
    expect(checkSchoolHeadLogin({ password: "123456" })).toEqual({});
  });
});

describe("checkTeacherRegister", () => {
  const ok = {
    firstName: "Ana",
    lastName: "Cruz",
    email: "ana@school.edu",
    password: "Passw0rd1",
    confirmPassword: "Passw0rd1",
  };

  it("passes a complete, matching form", () => {
    expect(checkTeacherRegister(ok)).toEqual({});
  });

  it("flags every empty required field at once", () => {
    expect(
      checkTeacherRegister({ firstName: " ", lastName: "", email: "", password: "", confirmPassword: "" }),
    ).toEqual({
      firstName: M.firstNameMissing,
      lastName: M.lastNameMissing,
      email: M.emailMissing,
      password: M.passwordMissing,
      confirmPassword: M.confirmMissing,
    });
  });

  it("keeps the password-strength message and the mismatch message", () => {
    const errors = checkTeacherRegister({ ...ok, password: "short", confirmPassword: "other" });
    expect(errors.password).toBe("Password must be at least 8 characters");
    expect(errors.confirmPassword).toBe(M.confirmMismatch);
  });
});

describe("firstLoginFieldError", () => {
  it("picks the topmost field with a problem", () => {
    expect(firstLoginFieldError({ password: "x", lastName: "y" })).toBe("lastName");
    expect(firstLoginFieldError({})).toBeUndefined();
  });
});
