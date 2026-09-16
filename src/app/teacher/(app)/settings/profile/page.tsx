import { requireSchoolUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isSyntheticEmail } from "@/lib/auth/synthetic-email";
import { getSchoolName } from "@/lib/cache/school";
import { teacherBannerSrc } from "@/lib/dashboard/banner";
import { TEACHER_POSITION_LABELS } from "@/lib/constants/enum-labels";
import { computeProfileCompletion } from "@/lib/teachers/profile-completion";
import { AppShell } from "@/components/app-shell";
import { TeacherProfileForm } from "@/components/forms/teacher-profile-form";
import { TeacherProfileSummary } from "@/components/settings/teacher-profile-summary";
import { TeacherSettingsShell } from "@/components/settings/teacher-settings-shell";

export const dynamic = "force-dynamic";

export default async function TeacherSettingsProfilePage() {
  const user = await requireSchoolUser("TEACHER");
  const [profile, grades, schoolName] = await Promise.all([
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
    // School-scoped by the session's own schoolId (`where: { id }`), cached.
    getSchoolName(user.schoolId),
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

  const defaultValues = {
    firstName: user.firstName,
    middleName: user.middleName ?? "",
    lastName: user.lastName,
    accountEmail: user.email,
    accountEmailIsSynthetic: isSyntheticEmail(user.email),
    sectionId: user.advisorySectionId,
    ...(profile ?? {}),
  };

  const completion = computeProfileCompletion(defaultValues);

  return (
    <AppShell
      title="Profile Settings"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      hideTitle
    >
      <TeacherSettingsShell active="profile" bannerSrc={teacherBannerSrc(profile?.gender)}>
        <TeacherProfileForm
          presentation="edit"
          gradeLevels={gradeLevels}
          defaultValues={defaultValues}
          summary={
            <TeacherProfileSummary
              roleLabel={profile?.designation || "Teacher"}
              roleHint={profile?.position ? TEACHER_POSITION_LABELS[profile.position] : undefined}
              isActive={user.isActive}
              schoolName={schoolName}
              completionPercent={completion.percent}
            />
          }
        />
      </TeacherSettingsShell>
    </AppShell>
  );
}
