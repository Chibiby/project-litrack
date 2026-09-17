import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ProfilePhotoCard } from "@/components/profile-photo/profile-photo-card";
import { SchoolHeadProfileForm } from "@/components/forms/sh-profile-form";
import { getSchoolStructureDefaults } from "@/lib/school-structure-defaults";
import { readTestLabSession } from "@/lib/auth/test-lab";
import { markProfilePhotoRemovalsRead } from "@/lib/notifications";

export const dynamic = "force-dynamic";

export default async function SchoolHeadSettingsProfilePage() {
  const user = await requireUser("SCHOOL_HEAD");
  const [profile, dryRun] = await Promise.all([
    prisma.schoolHeadProfile.findUnique({ where: { userId: user.id } }),
    readTestLabSession(user),
    // This IS the page a profile-photo-removal notice points at — landing here
    // is what clears it from the bell. Only a real School Head holds one (a
    // Super Admin viewing this route has no schoolId and gets no row to
    // clear); never throws, same posture as the read below.
    user.schoolId
      ? markProfilePhotoRemovalsRead({ recipientId: user.id, schoolId: user.schoolId }).catch(
          (err) => {
            console.error(
              "[school-head/settings/profile] photo notice mark-read failed:",
              err
            );
          }
        )
      : Promise.resolve(),
  ]);
  const structure = user.schoolId
    ? await getSchoolStructureDefaults(user.schoolId)
    : { gradeTypes: [], sectionsPerGrade: 1, existingGradeStats: [] };

  return (
    <div className="space-y-6">
      <ProfilePhotoCard
        name={user.fullName || `${user.firstName} ${user.lastName}`}
        avatarPath={user.avatarPath}
      />
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
    </div>
  );
}
