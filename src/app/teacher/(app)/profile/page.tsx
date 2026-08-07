import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { AppShell } from "@/components/app-shell";
import { TeacherProfileForm } from "@/components/forms/teacher-profile-form";

export const dynamic = "force-dynamic";

export default async function TeacherProfilePage() {
  const user = await requireUser("TEACHER");
  const profile = await prisma.teacherProfile.findUnique({ where: { userId: user.id } });

  return (
    <AppShell
      title="Profile"
      subtitle="Update your teacher profile"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
    >
      <TeacherProfileForm
        defaultValues={{
          accountEmail: user.email,
          accountEmailIsSynthetic: isSyntheticEmail(user.email),
          ...(profile ?? {}),
        }}
      />
    </AppShell>
  );
}
