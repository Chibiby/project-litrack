import { z } from "zod";
import { nonEmpty, email } from "./common";

/** Password: min 8 chars, at least one letter and one number. */
export const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[a-zA-Z]/, "Password must contain a letter")
  .regex(/[0-9]/, "Password must contain a number");

export const schoolLoginSchema = z.object({
  schoolId: nonEmpty("Please select a school"),
  role: z.enum(["SCHOOL_HEAD", "TEACHER"]),
  password: nonEmpty("Password required"),
  teacherEmail: z.string().email().optional(),
});

export const teacherLoginSchema = z.object({
  schoolId: nonEmpty("Please select a school"),
  username: nonEmpty("Username required"),
  password: nonEmpty("Password required"),
});

export const adminLoginSchema = z.object({
  email,
  password: nonEmpty("Password required"),
});

export const teacherSetupSchema = z
  .object({
    token: nonEmpty(),
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

export type SchoolLoginInput = z.infer<typeof schoolLoginSchema>;
export type TeacherLoginInput = z.infer<typeof teacherLoginSchema>;
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type TeacherSetupInput = z.infer<typeof teacherSetupSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
