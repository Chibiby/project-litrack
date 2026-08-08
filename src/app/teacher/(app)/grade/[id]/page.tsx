import { Suspense } from "react";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LearnerForm } from "@/components/forms/learner-form";
import {
  LearnerListClient,
  type LearnerListRow,
} from "@/components/learners/learner-list-client";
import { TableSectionSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  parseLearnerListParams,
  sectionIdWhere,
} from "@/lib/learners/pagination";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface TeacherGradePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    schoolId?: string;
    page?: string;
    q?: string;
    filter?: string;
    sort?: string;
    section?: string;
  }>;
}

async function GradeLearnersBody({
  gradeId,
  teacherId,
  isSuperAdmin,
  schoolIdParam,
  list,
  sections,
}: {
  gradeId: string;
  teacherId: string;
  isSuperAdmin: boolean;
  schoolIdParam?: string;
  list: ReturnType<typeof parseLearnerListParams>;
  sections: { id: string; name: string }[];
}) {
  const where: Prisma.LearnerWhereInput = {
    gradeLevelId: gradeId,
    deletedAt: null,
    ...(isSuperAdmin ? {} : { teacherId }),
    ...sectionIdWhere(list.section),
  };

  if (list.filter === "archived") {
    where.archivedAt = { not: null };
  } else {
    where.archivedAt = null;
    if (list.filter === "aral") {
      where.isAralLearner = true;
    }
  }

  const orderBy: Prisma.LearnerOrderByWithRelationInput =
    list.sort === "age" ? { age: "asc" } : { fullName: "asc" };

  const learners = await prisma.learner.findMany({
    where,
    include: { section: { select: { id: true, name: true } } },
    orderBy,
  });

  const rows: LearnerListRow[] = learners.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    age: l.age,
    gender: l.gender,
    isAralLearner: l.isAralLearner,
    archivedAt: l.archivedAt ? l.archivedAt.toISOString() : null,
    englishReadingProfile: l.englishReadingProfile,
    filipinoReadingProfile: l.filipinoReadingProfile,
    section: l.section,
  }));

  return (
    <LearnerListClient
      gradeId={gradeId}
      filter={list.filter}
      sort={list.sort}
      section={list.section}
      sections={sections}
      schoolId={schoolIdParam}
      isSuperAdmin={isSuperAdmin}
      learners={rows}
    />
  );
}

export default async function TeacherGradePage({
  params,
  searchParams,
}: TeacherGradePageProps) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const list = parseLearnerListParams(sp);

  const gradeFilter = isSuperAdmin
    ? { id, deletedAt: null }
    : { id, deletedAt: null, teachers: { some: { id: user.id } } };

  const grade = await prisma.gradeLevel.findFirst({
    where: gradeFilter,
  });
  if (!grade) notFound();

  const sectionClause = sectionIdWhere(list.section);

  const [totalCount, aralCount, gradeSections] = await Promise.all([
    prisma.learner.count({
      where: {
        gradeLevelId: grade.id,
        deletedAt: null,
        archivedAt: list.filter === "archived" ? { not: null } : null,
        ...(list.filter === "aral" ? { isAralLearner: true } : {}),
        ...(isSuperAdmin ? {} : { teacherId: user.id }),
        ...sectionClause,
      },
    }),
    prisma.learner.count({
      where: {
        gradeLevelId: grade.id,
        deletedAt: null,
        archivedAt: null,
        isAralLearner: true,
        ...(isSuperAdmin ? {} : { teacherId: user.id }),
      },
    }),
    prisma.section.findMany({
      where: { gradeLevelId: grade.id, schoolId: grade.schoolId, deletedAt: null },
      select: { id: true, name: true, gradeLevelId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const sectionOptions = gradeSections.map((s) => ({ id: s.id, name: s.name }));

  return (
    <AppShell
      title={GRADE_LEVEL_LABELS[grade.type]}
      subtitle={`${totalCount} learner${totalCount === 1 ? "" : "s"} · ${aralCount} ARAL${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <div className="mb-4 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/teacher">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        {aralCount > 0 && (
          <Button asChild variant="outline">
            <Link href={`/teacher/aral/${grade.id}`}>Open ARAL Dashboard</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <Suspense fallback={<TableSectionSkeleton rows={8} columns={6} />}>
          <GradeLearnersBody
            gradeId={grade.id}
            teacherId={user.id}
            isSuperAdmin={isSuperAdmin}
            schoolIdParam={sp.schoolId}
            list={list}
            sections={sectionOptions}
          />
        </Suspense>

        {!isSuperAdmin && (
          <Card>
            <CardContent className="pt-6">
              <h2 className="font-semibold mb-3">Add new learner</h2>
              <LearnerForm gradeLevelId={grade.id} sections={gradeSections} />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
