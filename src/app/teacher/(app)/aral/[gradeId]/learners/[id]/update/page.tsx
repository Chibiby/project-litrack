import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { AralUpdateForm } from "@/components/forms/aral-update-form";
import { Button } from "@/components/ui/button";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { getAralActionWarmHrefs } from "@/lib/nav/warm-hrefs";
import { teacherLearnerScope } from "@/lib/teachers/scope";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface UpdateAralDataPageProps {
  params: Promise<{ gradeId: string; id: string }>;
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function UpdateAralDataPage({
  params,
  searchParams,
}: UpdateAralDataPageProps) {
  const { gradeId, id } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const learnerFilter: Prisma.LearnerWhereInput = isSuperAdmin
    ? { id, isAralLearner: true, deletedAt: null }
    : {
        id,
        schoolId: user.schoolId ?? undefined,
        isAralLearner: true,
        deletedAt: null,
        ...teacherLearnerScope(user.id),
      };

  const learner = await prisma.learner.findFirst({
    where: learnerFilter,
    include: { aralProfile: true },
  });
  if (!learner) notFound();
  if (learner.gradeLevelId !== gradeId) notFound();

  const nestedWarmHrefs = getAralActionWarmHrefs(gradeId, learner.id);
  const nestedWarmKey = `teacher:aral-action:${learner.id}:nested`;

  return (
    <AppShell
      title={`Update Data — ${learner.fullName}`}
      subtitle={`Additional ARAL profiling${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <NavPrefetcher cacheKey={nestedWarmKey} hrefs={nestedWarmHrefs} />
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/aral?grade=${gradeId}`} prefetch={true}>
            <ArrowLeft className="h-4 w-4" /> Back to ARAL Dashboard
          </Link>
        </Button>
      </div>
      <AralUpdateForm
        learnerId={learner.id}
        defaultValues={learner.aralProfile ?? undefined}
      />
    </AppShell>
  );
}
