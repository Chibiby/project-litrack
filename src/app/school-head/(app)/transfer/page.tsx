import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { TransferLearnerForm } from "@/components/school-head/transfer-learner-form";
import { TableSectionSkeleton } from "@/components/loading";
import { ArrowRightLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

async function TransferBody({
  schoolId,
  isSuperAdminView,
}: {
  schoolId: string;
  isSuperAdminView: boolean;
}) {
  const [learnerCount, grades, sections, teachers, activeYear] =
    await Promise.all([
      prisma.learner.count({
        where: { schoolId, deletedAt: null, archivedAt: null },
      }),
      prisma.gradeLevel.findMany({
        where: { schoolId, deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, type: true },
      }),
      prisma.section.findMany({
        where: { schoolId, deletedAt: null },
        select: { id: true, name: true, gradeLevelId: true },
      }),
      prisma.user.findMany({
        where: {
          schoolId,
          role: "TEACHER",
          deletedAt: null,
          isActive: true,
        },
        select: {
          id: true,
          fullName: true,
          taughtGrades: { select: { id: true } },
        },
      }),
      prisma.schoolYear.findFirst({
        where: { schoolId, isActive: true },
        select: { id: true },
      }),
    ]);

  return (
    <>
      {!activeYear ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No active school year. Transfer will update learner pointers, but a
          new Enrollment row is only created when an active year exists.{" "}
          <a
            href={
              isSuperAdminView
                ? `/school-head/school-years?schoolId=${schoolId}`
                : "/school-head/school-years"
            }
            className="underline"
          >
            Manage school years
          </a>
        </div>
      ) : null}

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">Transfer</CardTitle>
        </CardHeader>
        <CardContent>
          {isSuperAdminView ? (
            <p className="text-sm text-muted-foreground">
              Transfers must be performed by the School Head for this school.
            </p>
          ) : learnerCount === 0 ? (
            <EmptyState
              title="No learners to transfer"
              description="Add learners from the teacher grade views first."
              icon={ArrowRightLeft}
            />
          ) : (
            <TransferLearnerForm
              schoolId={schoolId}
              grades={grades.map((g) => ({
                id: g.id,
                label: GRADE_LEVEL_LABELS[g.type],
              }))}
              sections={sections}
              teachers={teachers.map((t) => ({
                id: t.id,
                fullName: t.fullName,
                gradeIds: t.taughtGrades.map((g) => g.id),
              }))}
            />
          )}
        </CardContent>
      </Card>
    </>
  );
}

export default async function TransferPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN")
    redirect("/school-head/profiling");

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head/transfer"
  );

  const schoolName = await getSchoolName(schoolId);

  return (
    <AppShell
      title={
        isSuperAdminView
          ? `Transfer — ${schoolName ?? ""}`
          : "Transfer learner"
      }
      subtitle="Same-school transfer of grade, section, and teacher"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={schoolName ?? undefined}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={schoolName ?? undefined}
    >
      <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
        <TransferBody
          schoolId={schoolId}
          isSuperAdminView={isSuperAdminView}
        />
      </Suspense>
    </AppShell>
  );
}
