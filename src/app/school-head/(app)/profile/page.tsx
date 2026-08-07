import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { AppShell } from "@/components/app-shell";
import { SchoolHeadProfileForm } from "@/components/forms/sh-profile-form";

export const dynamic = "force-dynamic";

export default async function SchoolHeadProfilePage() {
  const user = await requireUser("SCHOOL_HEAD");
  const profile = await prisma.schoolHeadProfile.findUnique({ where: { userId: user.id } });

  return (
    <AppShell
      title="Profile"
      subtitle="Update your school head profile"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
    >
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
    </AppShell>
  );
}
