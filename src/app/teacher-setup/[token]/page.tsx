import { hashToken } from "@/lib/auth/invites";
import { prisma } from "@/lib/prisma";
import { isPrismaConnectionError } from "@/lib/auth/app-user";
import { TeacherSetupForm } from "@/components/forms/teacher-setup-form";
import { Card, CardContent } from "@/components/ui/card";
import { GraduationCap } from "lucide-react";

export const dynamic = "force-dynamic";

type InviteWithSchool = {
  email: string;
  firstName: string;
  lastName: string;
  consumedAt: Date | null;
  expiresAt: Date;
  school: { name: string };
};

export default async function TeacherSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tokenHash = hashToken(token);

  let invite: InviteWithSchool | null = null;
  let dbUnavailable = false;

  try {
    invite = await prisma.teacherInvite.findUnique({
      where: { tokenHash },
      include: { school: { select: { name: true } } },
    });
  } catch (err) {
    if (isPrismaConnectionError(err)) {
      dbUnavailable = true;
    } else {
      throw err;
    }
  }

  const valid =
    !dbUnavailable &&
    invite != null &&
    !invite.consumedAt &&
    invite.expiresAt > new Date();

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-card">
            <GraduationCap className="h-7 w-7" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold">Set up your account</h1>
          {valid && invite ? (
            <p className="text-sm text-muted-foreground">
              You&apos;re invited to join <strong>{invite.school.name}</strong>
            </p>
          ) : null}
        </div>
        {dbUnavailable ? (
          <Card>
            <CardContent className="pt-6 text-center text-sm text-muted-foreground">
              Service temporarily unavailable. Please try again later.
            </CardContent>
          </Card>
        ) : !valid || !invite ? (
          <Card>
            <CardContent className="pt-6 text-center text-sm text-destructive">
              This invite link is invalid or has expired. Ask your School Head for a new one.
            </CardContent>
          </Card>
        ) : (
          <TeacherSetupForm
            token={token}
            email={invite.email}
            name={[invite.firstName, invite.lastName].join(" ")}
          />
        )}
      </div>
    </main>
  );
}
