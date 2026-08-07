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
  role: z.enum(["SCHOOL_HEAD", "TEACHER"]),
  password: nonEmpty("Password required"),
  teacherEmail: z.string().email().optional(),
});

export const adminLoginSchema = z.object({
  email,
  password: nonEmpty("Password required"),
});

export const teacherAuthIntentSchema = z.enum(["login", "register"]);

const teacherOtpBase = {
  schoolId: nonEmpty("Please select a school"),
  email,
  intent: teacherAuthIntentSchema,
  firstName: z.string().optional(),
  middleName: optionalString,
  lastName: z.string().optional(),
};

export const requestTeacherOtpSchema = z
  .object(teacherOtpBase)
  .superRefine((data, ctx) => {
    if (data.intent === "register") {
      if (!data.firstName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "First name is required",
          path: ["firstName"],
        });
      }
      if (!data.lastName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Last name is required",
          path: ["lastName"],
        });
      }
    }
  });

export const verifyTeacherOtpSchema = z
  .object({
    ...teacherOtpBase,
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Enter the 6-digit code"),
  })
  .superRefine((data, ctx) => {
    if (data.intent === "register") {
      if (!data.firstName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "First name is required",
          path: ["firstName"],
        });
      }
      if (!data.lastName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Last name is required",
          path: ["lastName"],
        });
      }
    }
  });

export const startTeacherGoogleOAuthSchema = z.object({
  schoolId: nonEmpty("Please select a school"),
  intent: teacherAuthIntentSchema,
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
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type RequestTeacherOtpInput = z.infer<typeof requestTeacherOtpSchema>;
export type VerifyTeacherOtpInput = z.infer<typeof verifyTeacherOtpSchema>;
export type StartTeacherGoogleOAuthInput = z.infer<typeof startTeacherGoogleOAuthSchema>;
export type SetPasswordInput = z.infer<typeof setPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
