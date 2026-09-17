import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { SchoolHeadProfileForm } from "@/components/forms/sh-profile-form";
import { getSchoolStructureDefaults } from "@/lib/school-structure-defaults";
import { readTestLabSession } from "@/lib/auth/test-lab";

export const dynamic = "force-dynamic";

export default async function SchoolHeadSettingsProfilePage() {
  const user = await requireUser("SCHOOL_HEAD");
  const [profile, dryRun] = await Promise.all([
    prisma.schoolHeadProfile.findUnique({ where: { userId: user.id } }),
    readTestLabSession(user),
  ]);
  const structure = user.schoolId
    ? await getSchoolStructureDefaults(user.schoolId)
    : { gradeTypes: [], sectionsPerGrade: 1, existingGradeStats: [] };

  return (
    <SchoolHeadProfileForm
      presentation="edit"
      dryRun={dryRun}
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
