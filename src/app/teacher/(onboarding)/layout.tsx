import Image from "next/image";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { logoutAction } from "@/lib/actions/auth";
import { SignOutButton } from "@/components/sign-out-button";

export const dynamic = "force-dynamic";

export default async function TeacherOnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser("TEACHER");

  if (user.profileCompleted) {
    redirect("/teacher");
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <Image
              src="/logo.png"
              alt="LITRACK logo"
              width={36}
              height={48}
              className="h-9 w-auto"
              priority
            />
            <span className="truncate text-sm font-bold tracking-tight text-foreground">
              LITRACK
            </span>
          </div>
          <form action={logoutAction}>
            <SignOutButton />
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
