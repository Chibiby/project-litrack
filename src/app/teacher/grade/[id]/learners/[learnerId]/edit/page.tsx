import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LearnerForm } from "@/components/forms/learner-form";
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

  const learner = await prisma.learner.findFirst({
    where: {
      id: learnerId,
      teacherId: user.id,
      deletedAt: null,
      archivedAt: null,
    },
  });
  if (!learner) notFound();
  if (learner.gradeLevelId !== gradeId) notFound();

  return (
    <AppShell
      title={`Edit — ${learner.fullName}`}
      subtitle="Update Section A profile"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
    >
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/grade/${gradeId}/learners/${learner.id}`}>
            <ArrowLeft className="h-4 w-4" /> Back to learner
          </Link>
        </Button>
      </div>

      <Card className="max-w-2xl">
        <CardContent className="pt-6">
          <LearnerForm
            gradeLevelId={gradeId}
            mode="edit"
            submitLabel="Save changes"
            defaultValues={{
              id: learner.id,
              firstName: learner.firstName,
              middleName: learner.middleName,
              lastName: learner.lastName,
              age: learner.age,
              gender: learner.gender,
              englishReadingProfile: learner.englishReadingProfile,
              englishFrustrationSubtypes: learner.englishFrustrationSubtypes,
              filipinoReadingProfile: learner.filipinoReadingProfile,
              filipinoFrustrationSubtypes: learner.filipinoFrustrationSubtypes,
              governmentBenefits: learner.governmentBenefits,
              parentEducation: learner.parentEducation,
            }}
          />
        </CardContent>
      </Card>
    </AppShell>
  );
}
