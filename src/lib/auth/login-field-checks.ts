import { z } from "zod";
import { strongPassword } from "@/lib/validators/auth.schema";

/**
 * What the /login forms check in the browser when a button is pressed, before
 * anything is sent. These replace the browser's own pop-up bubbles (the forms
 * use noValidate), so every warning shows inline under its field, in our
 * words, and only after a press. The server still validates everything.
 */
export type LoginFieldKey = "firstName" | "lastName" | "email" | "password" | "confirmPassword";
export type LoginFieldErrors = Partial<Record<LoginFieldKey, string>>;

/** Top-to-bottom order of the fields, for "focus the first problem". */
export const LOGIN_FIELD_ORDER: LoginFieldKey[] = [
  "firstName",
  "lastName",
  "email",
  "password",
  "confirmPassword",
];

export const LOGIN_CHECK_MESSAGES = {
  emailMissing: "Enter your email",
  emailInvalid: "Enter a full email address, like name@school.edu",
  passwordMissing: "Enter your password",
  schoolIdMissing: "Enter your School ID or password",
  firstNameMissing: "Enter your first name",
  lastNameMissing: "Enter your last name",
  confirmMissing: "Enter your password again",
  confirmMismatch: "Passwords do not match",
} as const;

const PASSWORD_HINT = "Use at least 8 characters with a letter and a number.";
const emailShape = z.string().email();

function checkEmail(email: string): string | undefined {
  const value = email.trim();
  if (!value) return LOGIN_CHECK_MESSAGES.emailMissing;
  if (!emailShape.safeParse(value).success) return LOGIN_CHECK_MESSAGES.emailInvalid;
  return undefined;
}

function compact(errors: LoginFieldErrors): LoginFieldErrors {
  return Object.fromEntries(
    Object.entries(errors).filter(([, message]) => Boolean(message)),
  ) as LoginFieldErrors;
}

export function checkTeacherLogin(input: { email: string; password: string }): LoginFieldErrors {
  return compact({
    email: checkEmail(input.email),
    password: input.password ? undefined : LOGIN_CHECK_MESSAGES.passwordMissing,
  });
}

export function checkSchoolHeadLogin(input: { password: string }): LoginFieldErrors {
  return compact({
    password: input.password ? undefined : LOGIN_CHECK_MESSAGES.schoolIdMissing,
  });
}

export function checkTeacherRegister(input: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}): LoginFieldErrors {
  let password: string | undefined;
  if (!input.password) {
    password = LOGIN_CHECK_MESSAGES.passwordMissing;
  } else {
    const strength = strongPassword.safeParse(input.password);
    if (!strength.success) password = strength.error.errors[0]?.message ?? PASSWORD_HINT;
  }
  let confirmPassword: string | undefined;
  if (!input.confirmPassword) confirmPassword = LOGIN_CHECK_MESSAGES.confirmMissing;
  else if (input.confirmPassword !== input.password)
    confirmPassword = LOGIN_CHECK_MESSAGES.confirmMismatch;

  return compact({
    firstName: input.firstName.trim() ? undefined : LOGIN_CHECK_MESSAGES.firstNameMissing,
    lastName: input.lastName.trim() ? undefined : LOGIN_CHECK_MESSAGES.lastNameMissing,
    email: checkEmail(input.email),
    password,
    confirmPassword,
  });
}

/** The first field, top to bottom, that has a problem. */
export function firstLoginFieldError(errors: LoginFieldErrors): LoginFieldKey | undefined {
  return LOGIN_FIELD_ORDER.find((key) => errors[key]);
}
