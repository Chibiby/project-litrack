import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser, signOut } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { logoutAction } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { isDeactivatedTeacher } from "@/lib/auth/teacher-registration";
import { loginPath } from "@/lib/auth/session-end";
import { ImpersonationNotice } from "@/components/admin/impersonation-notice";

export const dynamic = "force-dynamic";

/**
 * Post–self-register success for teachers. Session required; pending teachers
 * must use allowPending so session.ts does not bounce them to /pending-approval.
 *
 * `?approved=1` is where a sign-up inside the automatic approval window lands.
 * The account is already approved, so the page says so and sends the teacher
 * back to sign in, which takes them on to profiling. Without the flag an
 * approved teacher goes straight to /teacher as before.
 */
export default async function AccountCreatedPage({
  searchParams,
}: {
  searchParams: Promise<{ approved?: string }>;
}) {
  const { approved: approvedParam } = await searchParams;
  const user = await getCurrentUser({ allowPending: true });
  if (!user) {
    redirect("/login");
  }

  if (user.role !== "TEACHER") {
    redirect("/login");
  }

  if (user.approvalStatus === "REJECTED") {
    await signOut();
    redirect(loginPath("school", "declined"));
  }

  if (isDeactivatedTeacher(user)) {
    await signOut();
    redirect(loginPath("school", "deactivated"));
  }

  const approved = user.approvalStatus === "APPROVED" && user.isActive;
  if (approved && approvedParam !== "1") {
    redirect("/teacher");
  }

  const school = user.schoolId
    ? await prisma.school.findUnique({
        where: { id: user.schoolId },
        select: { name: true },
      })
    : null;

  const userName = user.fullName || `${user.firstName} ${user.lastName}`;

  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center bg-background p-4"
    >
      {/*
        Same gating as /pending-approval (role TEACHER, not yet approved and
        active) and reachable the same way: without this an impersonating
        admin lands here with no way back.
      */}
      <ImpersonationNotice userId={user.id} accountName={userName} />
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <Image
            src="/logo.webp"
            alt="ARAL Program logo"
            width={192}
            height={256}
            priority
            className="mx-auto h-28 w-auto"
          />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">PROJECT LITRACK</h1>
        </div>

        <Card className="rounded-xl border border-border/80 shadow-sm">
          <CardHeader>
            <CardTitle>{approved ? "Account created and approved" : "Account created"}</CardTitle>
            <CardDescription>
              {approved ? (
                <>
                  Your teacher account at {school?.name ?? "your school"} is ready. No School Head
                  approval is needed. Go back to the sign-in page and sign in with your email and
                  password to set up your profile.
                </>
              ) : (
                <>
                  Your teacher account was created successfully and needs School Head approval at{" "}
                  {school?.name ?? "your school"} before you can use LITRACK. Contact your School
                  Head if this takes longer than expected. After approval, sign in with your email
                  and password.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">School</dt>
                <dd className="font-medium text-foreground">{school?.name ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="font-medium text-foreground">{user.email}</dd>
              </div>
            </dl>
            <form action={logoutAction}>
              <Button type="submit" className="w-full">
                Back to sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
