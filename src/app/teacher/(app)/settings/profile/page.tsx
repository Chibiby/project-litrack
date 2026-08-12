import { requireSchoolUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { TeacherProfileForm } from "@/components/forms/teacher-profile-form";

export const dynamic = "force-dynamic";

export default async function TeacherSettingsProfilePage() {
  const user = await requireSchoolUser("TEACHER");
  const [profile, grades] = await Promise.all([
    prisma.teacherProfile.findUnique({ where: { userId: user.id } }),
    prisma.gradeLevel.findMany({
      where: { schoolId: user.schoolId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        type: true,
        sections: {
          where: { deletedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true, adviser: { select: { id: true } } },
        },
      },
    }),
  ]);

  const gradeLevels = grades.map((g) => ({
    id: g.id,
    type: g.type,
    sections: g.sections.map((s) => ({
      id: s.id,
      name: s.name,
      takenByOther: s.adviser !== null && s.adviser.id !== user.id,
    })),
  }));

  return (
    <TeacherProfileForm
      presentation="edit"
      gradeLevels={gradeLevels}
      defaultValues={{
        firstName: user.firstName,
        middleName: user.middleName ?? "",
        lastName: user.lastName,
        accountEmail: user.email,
        accountEmailIsSynthetic: isSyntheticEmail(user.email),
        sectionId: user.advisorySectionId,
        ...(profile ?? {}),
      }}
    />
  );
}
