import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { getSchoolStructureDefaults } from "@/lib/school-structure-defaults";
import { AppShell } from "@/components/app-shell";
import { SchoolHeadProfileForm } from "@/components/forms/sh-profile-form";
import { SchoolHeadSettingsShell } from "@/components/settings/school-head-settings-shell";

export const dynamic = "force-dynamic";

// Explicit select, `gender` deliberately excluded: the column's migration has
// not been applied everywhere yet (see the gender read below), and an
// unscoped `findUnique` would pull it in and take the whole profile query
// down with it.
const SCHOOL_HEAD_PROFILE_SELECT = {
  contactNumber: true,
  contactEmail: true,
  designation: true,
  position: true,
  educationalAttainment: true,
  fieldOfSpecialization: true,
  specializationOther: true,
  yearsInService: true,
  hasReadingTraining: true,
  readingTrainings: true,
  hasEnglishTraining: true,
  englishTrainings: true,
  highestTrainingLevel: true,
} as const;

export default async function SchoolHeadSettingsProfilePage() {
  const user = await requireUser("SCHOOL_HEAD");

  const [profile, gender, structure] = await Promise.all([
    prisma.schoolHeadProfile.findUnique({
      where: { userId: user.id },
      select: SCHOOL_HEAD_PROFILE_SELECT,
    }),
    // Hero art must never take the page down: any read failure (including a
    // database the gender migration has not reached yet) falls back to the
    // default banner.
    prisma.schoolHeadProfile
      .findUnique({ where: { userId: user.id }, select: { gender: true } })
      .then((p) => p?.gender ?? null)
      .catch(() => null),
    user.schoolId
      ? getSchoolStructureDefaults(user.schoolId)
      : Promise.resolve({ gradeTypes: [], sectionsPerGrade: 1, existingGradeStats: [] }),
  ]);

  return (
    <AppShell
      title="Profile Settings"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      hideTitle
    >
      <SchoolHeadSettingsShell active="profile" bannerSrc={teacherBannerSrc(gender)}>
        <SchoolHeadProfileForm
          presentation="edit"
          defaultValues={{
            firstName: user.firstName,
            middleName: user.middleName ?? "",
            lastName: user.lastName,
            ...(profile ?? {}),
            gender: gender ?? undefined,
            gradeTypes: structure.gradeTypes,
            sectionsPerGrade: structure.sectionsPerGrade,
            existingGradeStats: structure.existingGradeStats,
          }}
        />
      </SchoolHeadSettingsShell>
    </AppShell>
  );
}
