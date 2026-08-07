import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { SchoolHeadProfileForm } from "@/components/forms/sh-profile-form";

export const dynamic = "force-dynamic";

export default async function SHProfilingPage() {
  const user = await requireUser("SCHOOL_HEAD");
  const profile = await prisma.schoolHeadProfile.findUnique({ where: { userId: user.id } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          School Head Profiling
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Complete this profile to unlock the rest of the app
        </p>
      </div>
      <SchoolHeadProfileForm
        defaultValues={{
          firstName: user.firstName,
          middleName: user.middleName ?? "",
          lastName: user.lastName,
          accountEmail: user.email,
          accountEmailIsSynthetic: isSyntheticEmail(user.email),
          ...(profile ?? {}),
        }}
      />
    </div>
  );
}
