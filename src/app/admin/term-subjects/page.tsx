import { Suspense } from "react";
import type { GradeLevelType } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { BookOpen } from "lucide-react";
import { AdminPage } from "@/components/admin/admin-page";
import { SchoolHeadHero } from "@/components/school-head/school-head-hero";
import { TableSectionSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  MAX_ACTIVE_SUBJECTS_PER_GRADE,
  TERM_SHEET_GRADE_TYPES,
} from "@/lib/terms/subjects";
import { getManagedTermSubjectDefaults } from "@/lib/terms/subject-defaults-db";
import { TermSubjectDefaultsGradeTypePicker } from "@/components/admin/term-subject-defaults-grade-type-picker";
import { TermSubjectDefaultsManager } from "@/components/admin/term-subject-defaults-manager";
import { ResetAllSchoolsTermSubjectsButton } from "@/components/admin/reset-all-schools-term-subjects-button";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ type?: string }>;
}

function isTermSheetGradeType(value: string | undefined): value is GradeLevelType {
  return (
    value !== undefined &&
    (TERM_SHEET_GRADE_TYPES as readonly string[]).includes(value)
  );
}

async function TermSubjectDefaultsBody({ gradeType }: { gradeType: GradeLevelType }) {
  const { active, archived } = await getManagedTermSubjectDefaults(prisma, gradeType);

  return (
    <TermSubjectDefaultsManager
      // Remount on grade type switch: the manager holds active/archived in
      // `useOptimistic` state seeded once from props, and a new type's rows
      // must replace it rather than merge into it.
      key={gradeType}
      gradeLevelType={gradeType}
      gradeLabel={GRADE_LEVEL_LABELS[gradeType]}
      max={MAX_ACTIVE_SUBJECTS_PER_GRADE}
      initialActive={active.map(({ id, name, position }) => ({ id, name, position }))}
      initialArchived={archived.map(({ id, name, deletedAt }) => ({
        id,
        name,
        deletedAt: (deletedAt as Date).toISOString(),
      }))}
    />
  );
}

export default async function AdminTermSubjectDefaultsPage({ searchParams }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const sp = await searchParams;
  const gradeType: GradeLevelType = isTermSheetGradeType(sp.type)
    ? sp.type
    : TERM_SHEET_GRADE_TYPES[0];

  const gradeTypeOptions = TERM_SHEET_GRADE_TYPES.map((type) => ({
    id: type,
    label: GRADE_LEVEL_LABELS[type],
  }));

  return (
    <AdminPage
      title="Default term subjects"
      role={user.role}
      userName={user.fullName || user.email}
      hero={
        <SchoolHeadHero
          eyebrow="End of Terms"
          eyebrowIcon={BookOpen}
          title="Default term subjects"
          subtitle="New schools and resets use these subjects. Existing schools keep their own lists."
          meta="Kindergarten uses the competency checklist instead, so it is not listed here."
        />
      }
    >
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <TermSubjectDefaultsGradeTypePicker
            gradeTypes={gradeTypeOptions}
            selectedGradeType={gradeType}
          />
          <ResetAllSchoolsTermSubjectsButton />
        </div>
        <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
          <TermSubjectDefaultsBody gradeType={gradeType} />
        </Suspense>
      </div>
    </AdminPage>
  );
}
