import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { AralUpdateForm } from "@/components/forms/aral-update-form";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function UpdateAralDataPage({
  params,
}: {
  params: Promise<{ gradeId: string; id: string }>;
}) {
  const { gradeId, id } = await params;
  const user = await requireUser("TEACHER");
  if (!user.profileCompleted) redirect("/teacher/profiling");

  const learner = await prisma.learner.findFirst({
    where: { id, teacherId: user.id, isAralLearner: true, deletedAt: null },
    include: { aralProfile: true },
  });
  if (!learner) notFound();

  return (
    <AppShell
      title={`Update Data — ${learner.fullName}`}
      subtitle="Additional ARAL profiling (sections B–E)"
    >
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/aral/${gradeId}`}><ArrowLeft className="h-4 w-4" /> Back to ARAL Dashboard</Link>
        </Button>
      </div>
      <AralUpdateForm learnerId={learner.id} defaultValues={learner.aralProfile ?? undefined} />
    </AppShell>
  );
}
