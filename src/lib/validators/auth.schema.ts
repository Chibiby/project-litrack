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

export const adminLoginSchema = z.object({
  email,
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
 * Request email OTP for teacher account creation only.
 * Password is validated up front so the UI can fail before sending a code.
 */
export const requestTeacherRegisterOtpSchema = z
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

/**
 * Verify teacher registration OTP and set the account password.
 */
export const verifyTeacherRegisterOtpSchema = z
  .object({
    schoolId: nonEmpty("Please select a school"),
    email,
    ...teacherRegisterNames,
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code"),
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
export type RequestTeacherRegisterOtpInput = z.infer<typeof requestTeacherRegisterOtpSchema>;
export type VerifyTeacherRegisterOtpInput = z.infer<typeof verifyTeacherRegisterOtpSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ChangeEmailInput = z.infer<typeof changeEmailSchema>;
