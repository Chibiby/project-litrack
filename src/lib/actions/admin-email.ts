"use server";

import { action } from "@/lib/errors/action";
import { AppError, tooManyAttempts } from "@/lib/errors/app-error";
import { requireUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { isEmailConfigured, sendEmail } from "@/lib/email";
import { adminEmailSchema } from "@/lib/validators/admin-email.schema";
import { AUDIT_ACTIONS, writeAudit } from "@/lib/audit";
import type { ActionResult } from "@/lib/errors/result";

type AdminEmailResult = { sent: number; failed: { email: string; error: string }[] };

export const sendAdminEmail = action(
  "sendAdminEmail",
  async (input: unknown): Promise<ActionResult<AdminEmailResult>> => {
    const admin = await requireUser();
    if (admin.role !== "SUPER_ADMIN") {
      throw new AppError("AUTH_FORBIDDEN", { params: { what: "admin email" } });
    }

    const parsed = adminEmailSchema.safeParse(input);
    if (!parsed.success || parsed.data.recipients.length > 50) {
      throw new AppError("VALIDATION_FAILED", { params: { message: "Check the email recipients and message." } });
    }
    if (!isEmailConfigured()) {
      throw new AppError("CONFIG_MISSING", { detail: "RESEND_API_KEY and RESEND_FROM_EMAIL are required." });
    }

    for (let index = 0; index < parsed.data.recipients.length; index += 1) {
      const limit = await checkRateLimit(`admin-email:${admin.id}`, { limit: 100, windowMs: 60 * 60 * 1000 });
      if (!limit.ok) throw tooManyAttempts(limit.retryAfterMs, "RATE_LIMITED");
    }

    const failed: AdminEmailResult["failed"] = [];
    let sent = 0;
    for (const email of parsed.data.recipients) {
      try {
        await sendEmail({ to: [email], subject: parsed.data.subject, text: parsed.data.body });
        sent += 1;
      } catch {
        failed.push({ email, error: "Delivery failed" });
      }
    }

    await writeAudit({
      action: AUDIT_ACTIONS.ADMIN_EMAIL_SEND,
      resource: "EmailDelivery",
      userId: admin.id,
      metadata: { recipientCount: parsed.data.recipients.length, sentCount: sent, failedCount: failed.length },
    });

    return { ok: true, data: { sent, failed } };
  },
  { verb: "send email" }
);
