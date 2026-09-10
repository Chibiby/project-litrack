import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { SchoolHeadProfileForm } from "@/components/forms/sh-profile-form";
import { getSchoolStructureDefaults } from "@/lib/school-structure-defaults";

export const dynamic = "force-dynamic";

export default async function SchoolHeadSettingsProfilePage() {
  const user = await requireUser("SCHOOL_HEAD");
  const profile = await prisma.schoolHeadProfile.findUnique({ where: { userId: user.id } });
  const structure = user.schoolId
    ? await getSchoolStructureDefaults(user.schoolId)
    : { gradeTypes: [], sectionsPerGrade: 1, existingGradeStats: [] };

  return (
    <SchoolHeadProfileForm
      presentation="edit"
      defaultValues={{
        firstName: user.firstName,
        middleName: user.middleName ?? "",
        lastName: user.lastName,
        ...(profile ?? {}),
        gradeTypes: structure.gradeTypes,
        sectionsPerGrade: structure.sectionsPerGrade,
        existingGradeStats: structure.existingGradeStats,
      }}
    />
  );
}
