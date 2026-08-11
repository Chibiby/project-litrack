import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AralReadingLevelPanel } from "@/components/aral/aral-reading-level-panel";
import { TableSectionSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { getTeacherShellGrades } from "@/lib/dashboard/aggregates";
import {
  parseLearnerListParams,
  sectionIdWhere,
} from "@/lib/learners/pagination";
import {
  formatLocalDateKey,
  parseLocalDateKey,
} from "@/lib/date-keys";
import { getMonday } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ gradeId: string }>;
  searchParams: Promise<{
    schoolId?: string;
    section?: string;
    week?: string;
  }>;
}

export default async function AralGradeReadingLevelPage({
  params,
  searchParams,
}: PageProps) {
  const { gradeId } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const list = parseLearnerListParams(sp);
  const weekStart = getMonday(parseLocalDateKey(sp.week));
  const weekKey = formatLocalDateKey(weekStart);

  const gradeFilter = isSuperAdmin
    ? { id: gradeId, deletedAt: null }
    : { id: gradeId, deletedAt: null, teachers: { some: { id: user.id } } };

  const grade = await prisma.gradeLevel.findFirst({
    where: gradeFilter,
    select: { id: true, type: true, schoolId: true },
  });
  if (!grade) notFound();

  const learnerWhere: Prisma.LearnerWhereInput = {
    gradeLevelId: grade.id,
    isAralLearner: true,
    deletedAt: null,
    archivedAt: null,
    ...(isSuperAdmin ? {} : { teacherId: user.id }),
    ...sectionIdWhere(list.section),
  };

  const schoolIdForGrades =
    (isSuperAdmin ? sp.schoolId : user.schoolId) ?? grade.schoolId;

  const [gradeSections, learners, records, shellGrades] = await Promise.all([
    prisma.section.findMany({
      where: {
        gradeLevelId: grade.id,
        schoolId: grade.schoolId,
        deletedAt: null,
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.learner.findMany({
      where: learnerWhere,
      select: {
        id: true,
        fullName: true,
        section: { select: { name: true } },
      },
      orderBy: { fullName: "asc" },
    }),
    prisma.readingLevelRecord.findMany({
      where: {
        weekStart,
        learner: learnerWhere,
      },
      select: {
        learnerId: true,
        englishProfile: true,
        filipinoProfile: true,
        wordRecognitionLevel: true,
        readingComprehensionLevel: true,
        notes: true,
      },
    }),
    schoolIdForGrades
      ? getTeacherShellGrades({
          schoolId: schoolIdForGrades,
          teacherId: user.id,
          isSuperAdmin,
        })
      : Promise.resolve([]),
  ]);

  const showSection = gradeSections.length > 0;
  const basePath = `/teacher/aral/${grade.id}/reading-level`;
  const grades = shellGrades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type],
  }));
  if (!grades.some((g) => g.id === grade.id)) {
    grades.unshift({
      id: grade.id,
      label: GRADE_LEVEL_LABELS[grade.type],
    });
  }

  const gridLearners = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    sectionName: l.section?.name ?? null,
  }));

  return (
    <AppShell
      title={`ARAL Reading Level — ${GRADE_LEVEL_LABELS[grade.type]}`}
      subtitle={`Week of ${weekStart.toLocaleDateString()}${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/aral?grade=${grade.id}`}>
            <ArrowLeft className="h-4 w-4" /> Back to ARAL
          </Link>
        </Button>
      </div>

      <Card>
        <Suspense fallback={<TableSectionSkeleton rows={8} columns={7} />}>
          <AralReadingLevelPanel
            key={`${list.section}:${sp.schoolId ?? ""}`}
            gradeId={grade.id}
            gradeType={grade.type}
            grades={grades}
            basePath={basePath}
            initialWeekKey={weekKey}
            section={list.section}
            sections={gradeSections}
            showSection={showSection}
            schoolId={sp.schoolId}
            learners={gridLearners}
            initialExisting={records}
            readOnly={isSuperAdmin}
          />
        </Suspense>
      </Card>
    </AppShell>
  );
}
