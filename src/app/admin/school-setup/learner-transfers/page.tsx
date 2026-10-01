import { Suspense } from "react";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { Callout } from "@/components/ui/callout";
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
          // FLOATING is a same-school holding state, never a cross-school target.
          where: { schoolId: toSchoolId, deletedAt: null, type: { not: "FLOATING" } },
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
            // Derived from the one section the teacher advises, matching what
            // `transferLearnerCrossSchool` validates. `deletedAt` is selected
            // because Prisma cannot filter a to-one relation inside `select`.
            advisorySections: {
              where: { deletedAt: null },
              select: { gradeLevelId: true },
            },
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
        <Callout title="Target school has no active school year">
          The transfer will update the learner&apos;s school and grade, but a new
          enrollment is only created once that school has an active year.
        </Callout>
      ) : null}

      <Surface as="section" className="min-w-0 max-w-2xl rounded-2xl">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">Transfer a learner</h2>
        </SurfaceHeader>
        <SurfaceBody className="p-4 sm:p-5">
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
                // A teacher who advises three sections can receive a transfer
                // into any of their grades, so this is a set now rather than a
                // one-element list.
                gradeIds: [
                  ...new Set(t.advisorySections.map((s) => s.gradeLevelId)),
                ],
              }))}
            />
          )}
        </SurfaceBody>
      </Surface>
    </>
  );
}

export default async function AdminTransfersPage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const params = await searchParams;
  const fromSchoolId = params.from?.trim() || "";
  const toSchoolId = params.to?.trim() || "";

  return (
    <AdminPage
      title="Cross-school transfers"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="Learners"
          eyebrowIcon={ArrowRightLeft}
          title="Cross-school transfers"
          subtitle="Move a learner from one school to another. Pick the source school first, then the destination."
        />
      }
    >
      <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
        <AdminTransferBody
          fromSchoolId={fromSchoolId}
          toSchoolId={toSchoolId}
        />
      </Suspense>
    </AdminPage>
  );
}
