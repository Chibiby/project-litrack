import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  CreateSectionForm,
  SectionRowActions,
} from "@/components/school-head/section-forms";
import { Layers } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function SectionsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") redirect("/school-head/profiling");

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head/sections"
  );

  const [grades, sections, schoolName] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId, deletedAt: null },
      orderBy: { createdAt: "asc" },
    }),
    prisma.section.findMany({
      where: { schoolId, deletedAt: null },
      include: { gradeLevel: { select: { type: true } } },
      orderBy: [{ gradeLevelId: "asc" }, { name: "asc" }],
    }),
    getSchoolName(schoolId),
  ]);

  const gradeOptions = grades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type],
  }));

  return (
    <AppShell
      title={isSuperAdminView ? `Sections — ${schoolName ?? ""}` : "Sections"}
      subtitle="Manage sections under each grade level"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={schoolName ?? undefined}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={schoolName ?? undefined}
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {!isSuperAdminView && grades.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add section</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateSectionForm grades={gradeOptions} />
            </CardContent>
          </Card>
        ) : null}

        <Card className={isSuperAdminView || grades.length === 0 ? "lg:col-span-2" : undefined}>
          <CardHeader>
            <CardTitle className="text-base">Current sections</CardTitle>
          </CardHeader>
          <CardContent>
            {grades.length === 0 ? (
              <EmptyState
                title="Create a grade level first"
                description="Sections belong to grade levels."
                actionHref="/school-head/grade-levels"
                actionLabel="Grade levels"
                icon={Layers}
              />
            ) : sections.length === 0 ? (
              <EmptyState
                title="No sections yet"
                description="Add a section for each class group."
                icon={Layers}
              />
            ) : (
              <ul className="space-y-3">
                {sections.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 px-4 py-3"
                  >
                    <div>
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {GRADE_LEVEL_LABELS[s.gradeLevel.type]}
                      </p>
                    </div>
                    {!isSuperAdminView ? (
                      <SectionRowActions sectionId={s.id} name={s.name} />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
