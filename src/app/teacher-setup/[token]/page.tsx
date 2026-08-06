import { hashToken, findTeacherForInvite, inviteTokenStatus } from "@/lib/auth/invites";
import { prisma } from "@/lib/prisma";
import { TeacherSetupForm } from "@/components/forms/teacher-setup-form";
import { Card, CardContent } from "@/components/ui/card";
import { GraduationCap } from "lucide-react";
import { usernameFromTeacherEmail } from "@/lib/auth/synthetic-email";

export const dynamic = "force-dynamic";

export default async function TeacherSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tokenHash = hashToken(token);
  const invite = await prisma.teacherInvite.findUnique({
    where: { tokenHash },
    include: { school: { select: { name: true } } },
  });

  const tokenOk = Boolean(invite && inviteTokenStatus(invite) === "pending");
  const teacher = invite && tokenOk ? await findTeacherForInvite(invite, token) : null;
  const valid = Boolean(tokenOk && teacher && teacher.isActive);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <GraduationCap className="h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold">Set up your account</h1>
          {valid && invite ? (
            <p className="text-sm text-muted-foreground">
              You&apos;re invited to join <strong>{invite.school.name}</strong>
            </p>
          ) : null}
        </div>
        {!valid || !invite || !teacher ? (
          <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
            <CardContent className="pt-6 text-center text-sm text-destructive">
              This invite link is invalid or has expired. Ask your School Head for a new one.
            </CardContent>
          </Card>
        ) : (
          <TeacherSetupForm
            token={token}
            name={[invite.firstName, invite.lastName].join(" ")}
            email={invite.email}
            usernameHint={usernameFromTeacherEmail(teacher.email)}
          />
        )}
      </div>
    </main>
  );
}
