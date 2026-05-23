import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { SchoolHeadProfileForm } from "@/components/forms/sh-profile-form";

export const dynamic = "force-dynamic";

export default async function SHProfilingPage() {
  const user = await requireUser("SCHOOL_HEAD");
  const profile = await prisma.schoolHeadProfile.findUnique({ where: { userId: user.id } });

  return (
    <AppShell
      title="School Head Profiling"
      subtitle="Complete this profile to unlock the rest of the app"
    >
      <SchoolHeadProfileForm
        defaultValues={{
          firstName: user.firstName,
          middleName: user.middleName ?? "",
          lastName: user.lastName,
          ...(profile ?? {}),
        }}
      />
    </AppShell>
  );
}
