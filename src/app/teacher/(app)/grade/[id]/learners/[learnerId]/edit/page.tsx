import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LearnerForm } from "@/components/forms/learner-form";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { getLearnerDetailWarmHrefs } from "@/lib/nav/warm-hrefs";
import { teacherLearnerScope } from "@/lib/teachers/scope";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface EditLearnerPageProps {
  params: Promise<{ id: string; learnerId: string }>;
}

export default async function EditLearnerPage({ params }: EditLearnerPageProps) {
  const { id: gradeId, learnerId } = await params;
  const user = await requireUser("TEACHER");

  if (user.role === "SUPER_ADMIN") {
    redirect(`/teacher/grade/${gradeId}/learners/${learnerId}`);
  }

  if (!user.profileCompleted) redirect("/teacher/profiling");

  // Matches `updateLearner`'s gate: advisory roster or ARAL designation.
  const learner = await prisma.learner.findFirst({
    where: {
      id: learnerId,
      schoolId: user.schoolId ?? undefined,
      deletedAt: null,
      archivedAt: null,
      ...teacherLearnerScope(user.id),
    },
    include: {
      gradeLevel: { select: { id: true, type: true } },
    },
  });
  if (!learner) notFound();
  if (learner.gradeLevelId !== gradeId) notFound();

  const gradeSections = await prisma.section.findMany({
    where: {
      gradeLevelId: gradeId,
      schoolId: learner.schoolId,
      deletedAt: null,
    },
    select: { id: true, name: true, gradeLevelId: true },
    orderBy: { name: "asc" },
  });

  const gradeType = learner.gradeLevel.type;
  const grades = [
    {
      id: learner.gradeLevel.id,
      type: gradeType,
      label: GRADE_LEVEL_LABELS[gradeType] ?? gradeType,
    },
  ];

  const nestedWarmHrefs = getLearnerDetailWarmHrefs(gradeId, learner);
  const nestedWarmKey = `teacher:learner:${learner.id}:edit`;

  return (
    <AppShell
      title={`Edit — ${learner.fullName}`}
      subtitle="Update Section A + B profile"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
    >
      <NavPrefetcher cacheKey={nestedWarmKey} hrefs={nestedWarmHrefs} />
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link
            href={`/teacher/grade/${gradeId}/learners/${learner.id}`}
            prefetch={true}
          >
            <ArrowLeft className="h-4 w-4" /> Back to learner
          </Link>
        </Button>
      </div>

      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <LearnerForm
            gradeLevelId={gradeId}
            gradeType={gradeType}
            grades={grades}
            mode="edit"
            submitLabel="Save changes"
            sections={gradeSections}
            defaultValues={{
              id: learner.id,
              firstName: learner.firstName,
              middleName: learner.middleName,
              lastName: learner.lastName,
              age: learner.age,
              gender: learner.gender,
              ethnicity: learner.ethnicity,
              ethnicityOther: learner.ethnicityOther,
              englishReadingProfile: learner.englishReadingProfile,
              englishFrustrationSubtypes: learner.englishFrustrationSubtypes,
              filipinoReadingProfile: learner.filipinoReadingProfile,
              filipinoFrustrationSubtypes: learner.filipinoFrustrationSubtypes,
              governmentBenefits: learner.governmentBenefits,
              parentEducation: learner.parentEducation,
              modeOfTransportation: learner.modeOfTransportation,
              distanceHomeToSchool: learner.distanceHomeToSchool,
              previousTransfers: learner.previousTransfers,
              transferDetails: learner.transferDetails,
              sectionId: learner.sectionId,
            }}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
