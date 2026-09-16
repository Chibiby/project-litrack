import { Suspense } from "react";
import type { GradeLevelType } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { TableSectionSkeleton } from "@/components/loading";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  MAX_ACTIVE_SUBJECTS_PER_GRADE,
  TERM_SHEET_GRADE_TYPES,
} from "@/lib/terms/subjects";
import { getManagedTermSubjectDefaults } from "@/lib/terms/subject-defaults-db";
import { TermSubjectDefaultsGradeTypePicker } from "@/components/admin/term-subject-defaults-grade-type-picker";
import { TermSubjectDefaultsManager } from "@/components/admin/term-subject-defaults-manager";

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
    <AppShell
      title="Default Term Subjects"
      subtitle="New schools and resets use these subjects. Existing schools keep their own lists. Kindergarten uses the competency checklist instead, so it is not listed here."
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="space-y-6">
        <TermSubjectDefaultsGradeTypePicker
          gradeTypes={gradeTypeOptions}
          selectedGradeType={gradeType}
        />
        <Suspense fallback={<TableSectionSkeleton rows={6} columns={3} />}>
          <TermSubjectDefaultsBody gradeType={gradeType} />
        </Suspense>
      </div>
    </AppShell>
  );
}
