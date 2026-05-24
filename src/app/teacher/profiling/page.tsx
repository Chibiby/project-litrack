import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { TeacherProfileForm } from "@/components/forms/teacher-profile-form";

export const dynamic = "force-dynamic";

export default async function TeacherProfilingPage() {
  const user = await requireUser("TEACHER");
  const profile = await prisma.teacherProfile.findUnique({ where: { userId: user.id } });

  return (
    <AppShell 
      title="Teacher Profiling" 
      subtitle="Complete this to start adding learners"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
    >
      <TeacherProfileForm defaultValues={profile ?? {}} />
    </AppShell>
  );
}
