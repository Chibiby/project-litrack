import { Suspense } from "react";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";
import { resolveSchoolHeadView, type SchoolHeadView } from "@/lib/school-head/view";
import {
  SchoolHeadPage,
  schoolHeadHref,
} from "@/components/school-head/school-head-page";
import { Callout } from "@/components/ui/callout";
import { Surface, SurfaceHeader, SurfaceBody } from "@/components/ui/surface";
import { EmptyState } from "@/components/dashboard/empty-state";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { TransferLearnerForm } from "@/components/school-head/transfer-learner-form";
import { TableSectionSkeleton } from "@/components/loading";
import { ArrowRightLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

async function TransferBody({ view }: { view: SchoolHeadView }) {
  const { schoolId, isSuperAdminView } = view;

  const [learnerCount, grades, sections, teachers, activeYear] =
    await Promise.all([
      prisma.learner.count({
        where: { schoolId, deletedAt: null, archivedAt: null },
      }),
      prisma.gradeLevel.findMany({
        // FLOATING is offered by the form as its own sentinel option (the row is
        // created on demand), so it must not also appear as a normal grade.
        where: { schoolId, deletedAt: null, type: { not: "FLOATING" } },
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
          // One advisory section per teacher, so the grade a teacher can receive
          // learners into is derived from that section. `deletedAt` is selected
          // because Prisma cannot filter a to-one relation inside `select`.
          advisorySection: {
            select: { name: true, gradeLevelId: true, deletedAt: true },
          },
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
        <Callout title="No active school year">
          The learner will move now, but the transfer will not be added to their
          enrolment history until a school year is active.{" "}
          <Link
            href={schoolHeadHref(view, SCHOOL_HEAD_ROUTES.schoolYears)}
            className="font-medium underline"
          >
            Manage school years
          </Link>
        </Callout>
      ) : null}

      <Surface as="section" className="max-w-xl">
        <SurfaceHeader>
          <h2 className="text-base font-semibold">Choose a learner</h2>
        </SurfaceHeader>
        <SurfaceBody>
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
              teachers={teachers.map((t) => {
                const advisory =
                  t.advisorySection && t.advisorySection.deletedAt === null
                    ? t.advisorySection
                    : null;
                return {
                  id: t.id,
                  fullName: t.fullName,
                  advisoryGradeId: advisory?.gradeLevelId ?? null,
                  advisorySectionName: advisory?.name ?? null,
                };
              })}
            />
          )}
        </SurfaceBody>
      </Surface>
    </>
  );
}

export default async function TransferPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const { view } = await resolveSchoolHeadView(
    params.schoolId,
    SCHOOL_HEAD_ROUTES.transfer
  );

  return (
    <SchoolHeadPage
      title="Transfer a learner"
      description="Move a learner to another grade, section, and adviser — or to Floating."
      view={view}
    >
      <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
        <TransferBody view={view} />
      </Suspense>
    </SchoolHeadPage>
  );
}
