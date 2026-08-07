import { redirect, notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { LearnerImportWizard } from "@/components/learners/lazy-learner-import-wizard";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function TeacherGradeImportPage({ params }: Props) {
  const { id } = await params;
  const user = await requireUser("TEACHER");

  if (user.role === "SUPER_ADMIN") {
    redirect(`/teacher/grade/${id}`);
  }
  if (!user.profileCompleted) redirect("/teacher/profiling");

  const grade = await prisma.gradeLevel.findFirst({
    where: {
      id,
      schoolId: user.schoolId!,
      deletedAt: null,
      teachers: { some: { id: user.id } },
    },
  });
  if (!grade) notFound();

  const label = GRADE_LEVEL_LABELS[grade.type] ?? grade.type;

  return (
    <AppShell
      title="Import learners"
      subtitle={`${label} · CSV bulk import`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
    >
      <LearnerImportWizard gradeLevelId={grade.id} gradeLabel={label} />
    </AppShell>
  );
}
