import { z } from "zod";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";

export const adminEmailSchema = z
  .object({
    recipients: z.array(z.string().trim().email()).min(1).max(50),
    subject: z.string().trim().min(1).max(160),
    body: z.string().trim().min(1).max(10_000),
  })
  .superRefine((value, context) => {
    value.recipients.forEach((email, index) => {
      if (isSyntheticEmail(email)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recipients", index],
          message: "Use a real email address",
        });
      }
    });
  })
  .transform((value) => ({
    ...value,
    recipients: [...new Set(value.recipients.map((email) => email.toLowerCase()))],
  }));

export type AdminEmailInput = z.infer<typeof adminEmailSchema>;
