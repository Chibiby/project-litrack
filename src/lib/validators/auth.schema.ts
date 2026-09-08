import { z } from "zod";
import { nonEmpty, email, optionalString } from "./common";

/** Password: min 8 chars, at least one letter and one number. */
export const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-zA-Z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

export const schoolLoginSchema = z.object({
  schoolId: nonEmpty("Please select a school"),
  role: z.literal("SCHOOL_HEAD"),
  password: nonEmpty("Password required"),
});

/**
 * Super Admin login handle.
 *
 * Trimmed and lower-cased before the length checks run, so "Admin", " admin "
 * and "ADMIN" all resolve to the one row: `User.username` stores the canonical
 * lower-case form, and every lookup goes through this schema first.
 */
export const adminUsername = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Username required")
  .max(64, "Username is too long");

/**
 * Super Admin sign-in. Username, not email — Supabase Auth still needs an
 * address, so `loginAdmin` resolves this handle to the account's stored email
 * server-side. Password recovery continues to use that email, never this.
 */
export const adminLoginSchema = z.object({
  username: adminUsername,
  password: nonEmpty("Password required"),
});

/** Teacher credential login (no OTP / codes). */
export const teacherLoginSchema = z.object({
  schoolId: nonEmpty("Please select a school"),
  email,
  password: nonEmpty("Password required"),
});

const teacherRegisterNames = {
  firstName: nonEmpty("First name is required"),
  middleName: optionalString,
  lastName: nonEmpty("Last name is required"),
};

/**
 * Teacher self-registration — one step: names, email, password.
 * No email verification code: the account is created PENDING and the School
 * Head approves it before the teacher can use LITRACK. Email is only used for
 * password recovery afterwards.
 */
export const teacherRegisterSchema = z
  .object({
    schoolId: nonEmpty("Please select a school"),
    email,
    ...teacherRegisterNames,
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const setPasswordSchema = z
  .object({
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: nonEmpty("Current password required"),
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  })
  .refine((d) => d.currentPassword !== d.password, {
    message: "New password must be different from current password",
    path: ["password"],
  });

export const forgotPasswordSchema = z.object({
  email,
});

export const changeEmailSchema = z
  .object({
    newEmail: email,
    confirmEmail: email,
    currentPassword: nonEmpty("Current password required"),
  })
  .refine((d) => d.newEmail.toLowerCase() === d.confirmEmail.toLowerCase(), {
    message: "Emails do not match",
    path: ["confirmEmail"],
  });

export type SchoolLoginInput = z.infer<typeof schoolLoginSchema>;
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type TeacherLoginInput = z.infer<typeof teacherLoginSchema>;
export type TeacherRegisterInput = z.infer<typeof teacherRegisterSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
