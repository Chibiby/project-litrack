import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { TeacherProfileForm } from "@/components/forms/teacher-profile-form";

export const dynamic = "force-dynamic";

export default async function TeacherSettingsProfilePage() {
  const user = await requireUser("TEACHER");
  const profile = await prisma.teacherProfile.findUnique({ where: { userId: user.id } });

  return (
    <TeacherProfileForm
      presentation="edit"
      defaultValues={{
        firstName: user.firstName,
        middleName: user.middleName ?? "",
        lastName: user.lastName,
        accountEmail: user.email,
        accountEmailIsSynthetic: isSyntheticEmail(user.email),
        ...(profile ?? {}),
      }}
    />
  );
}
