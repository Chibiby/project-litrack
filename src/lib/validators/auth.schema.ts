import { z } from "zod";
import { nonEmpty, email } from "./common";

export const schoolLoginSchema = z.object({
  schoolId: nonEmpty("Please select a school"),
  role: z.enum(["SCHOOL_HEAD", "TEACHER"]),
  password: nonEmpty("Password required"),
  // For teacher login, the email is required (since teachers have real emails)
  teacherEmail: z.string().email().optional(),
});

export const adminLoginSchema = z.object({
  email,
  password: nonEmpty("Password required"),
});

export const teacherSetupSchema = z
  .object({
    token: nonEmpty(),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type SchoolLoginInput = z.infer<typeof schoolLoginSchema>;
export type AdminLoginInput = z.infer<typeof adminLoginSchema>;
export type TeacherSetupInput = z.infer<typeof teacherSetupSchema>;
