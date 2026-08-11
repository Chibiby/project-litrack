import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { CrossSchoolTransferForm } from "@/components/admin/cross-school-transfer-form";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { TableSectionSkeleton } from "@/components/loading";
import { ArrowRightLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string }>;
}

async function AdminTransferBody({
  fromSchoolId,
  toSchoolId,
}: {
  fromSchoolId: string;
  toSchoolId: string;
}) {
  const schools = await prisma.school.findMany({
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const [grades, sections, teachers, targetActiveYear] = await Promise.all([
    toSchoolId
      ? prisma.gradeLevel.findMany({
          where: { schoolId: toSchoolId, deletedAt: null },
          orderBy: { createdAt: "asc" },
          select: { id: true, type: true },
        })
      : Promise.resolve([]),
    toSchoolId
      ? prisma.section.findMany({
          where: { schoolId: toSchoolId, deletedAt: null },
          select: { id: true, name: true, gradeLevelId: true },
        })
      : Promise.resolve([]),
    toSchoolId
      ? prisma.user.findMany({
          where: {
            schoolId: toSchoolId,
            role: "TEACHER",
            deletedAt: null,
            isActive: true,
          },
          select: {
            id: true,
            fullName: true,
            taughtGrades: { select: { id: true } },
          },
        })
      : Promise.resolve([]),
    toSchoolId
      ? prisma.schoolYear.findFirst({
          where: { schoolId: toSchoolId, isActive: true },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  return (
    <>
      {toSchoolId && !targetActiveYear ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Target school has no active school year. Transfer will update learner
          school/grade pointers, but a new Enrollment row is only created when
          an active year exists.
        </div>
      ) : null}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="text-base">Transfer learner</CardTitle>
        </CardHeader>
        <CardContent>
          {schools.length < 2 ? (
            <EmptyState
              title="Need at least two active schools"
              description="Create and activate another school before cross-school transfer."
              icon={ArrowRightLeft}
            />
          ) : (
            <CrossSchoolTransferForm
              schools={schools}
              fromSchoolId={fromSchoolId}
              toSchoolId={toSchoolId}
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

export default async function AdminTransfersPage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const params = await searchParams;
  const fromSchoolId = params.from?.trim() || "";
  const toSchoolId = params.to?.trim() || "";

  return (
    <AppShell
      title="Cross-school transfers"
      subtitle="Move a learner from one school to another (Super Admin)"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
        <AdminTransferBody
          fromSchoolId={fromSchoolId}
          toSchoolId={toSchoolId}
        />
      </Suspense>
    </AppShell>
  );
}
