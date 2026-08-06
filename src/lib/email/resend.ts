import "server-only";
import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;

export const resend = apiKey ? new Resend(apiKey) : null;

export async function sendTeacherInviteEmail(args: {
  to: string;
  teacherName: string;
  schoolName: string;
  inviteUrl: string;
  username?: string;
}) {
  const from = process.env.RESEND_FROM_EMAIL || "LITRACK <onboarding@resend.dev>";

  if (!resend) {
    console.warn("[email] RESEND_API_KEY not set — invite link issued (not logged with secrets)");
    return { id: "dev-no-email", devLink: args.inviteUrl };
  }

  const usernameLine = args.username
    ? `<p>Your username is <strong>${escapeHtml(args.username)}</strong>. You can also sign in on the login page after setting your password.</p>`
    : "";

  const { data, error } = await resend.emails.send({
    from,
    to: args.to,
    subject: `You've been invited to ${args.schoolName} on PROJECT LITRACK`,
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px">
        <h2 style="color:#2563eb">Welcome to PROJECT LITRACK</h2>
        <p>Hi <strong>${escapeHtml(args.teacherName)}</strong>,</p>
        <p>You've been invited to join <strong>${escapeHtml(args.schoolName)}</strong> as a teacher on PROJECT LITRACK.</p>
        ${usernameLine}
        <p>Click the button below to set up your password:</p>
        <p style="margin:24px 0">
          <a href="${args.inviteUrl}"
             style="background:#2563eb;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">
            Set up your account
          </a>
        </p>
        <p style="color:#666;font-size:13px">This link expires in 7 days. If you didn't expect this email, you can ignore it.</p>
      </div>
    `,
  });

  if (error) throw error;
  return { id: data?.id };
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}
