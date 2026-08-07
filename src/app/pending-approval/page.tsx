import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser, signOut } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { logoutAction } from "@/lib/actions/auth";
import { SignOutButton } from "@/components/sign-out-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DECLINED_REGISTRATION_MESSAGE } from "@/lib/auth/teacher-registration";

export const dynamic = "force-dynamic";

export default async function PendingApprovalPage() {
  const user = await getCurrentUser({ allowPending: true });
  if (!user) {
    redirect("/login");
  }

  if (user.role !== "TEACHER") {
    redirect("/login");
  }

  if (user.approvalStatus === "REJECTED") {
    await signOut();
    redirect(`/login?error=${encodeURIComponent(DECLINED_REGISTRATION_MESSAGE)}`);
  }

  if (user.approvalStatus === "APPROVED") {
    redirect("/teacher");
  }

  const school = user.schoolId
    ? await prisma.school.findUnique({
        where: { id: user.schoolId },
        select: { name: true },
      })
    : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="space-y-2 text-center">
          <Image
            src="/logo.png"
            alt="ARAL Program logo"
            width={192}
            height={256}
            priority
            className="mx-auto h-28 w-auto"
          />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">PROJECT LITRACK</h1>
        </div>

        <Card className="rounded-xl border border-border/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle>Awaiting approval</CardTitle>
            <CardDescription>
              Your registration is waiting for School Head approval. You will be able to continue
              once your account is approved.
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
              <SignOutButton />
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
