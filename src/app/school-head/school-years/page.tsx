import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  CreateSchoolYearForm,
  SetActiveYearButton,
} from "@/components/school-head/school-year-forms";
import { CalendarRange } from "lucide-react";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function SchoolYearsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") redirect("/school-head/profiling");

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head/school-years"
  );

  const [years, school] = await Promise.all([
    prisma.schoolYear.findMany({
      where: { schoolId },
      orderBy: { startDate: "desc" },
    }),
    prisma.school.findUnique({ where: { id: schoolId }, select: { name: true } }),
  ]);

  const active = years.find((y) => y.isActive);

  return (
    <AppShell
      title={isSuperAdminView ? `School Years — ${school?.name ?? ""}` : "School years"}
      subtitle="One active year per school. Learners need an active year for enrollment."
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={school?.name}
    >
      {!active ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No active school year. New learners will not receive an Enrollment record until you set
          one.
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {!isSuperAdminView ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Create school year</CardTitle>
            </CardHeader>
            <CardContent>
              <CreateSchoolYearForm />
            </CardContent>
          </Card>
        ) : null}

        <Card className={isSuperAdminView ? "lg:col-span-2" : undefined}>
          <CardHeader>
            <CardTitle className="text-base">Years</CardTitle>
          </CardHeader>
          <CardContent>
            {years.length === 0 ? (
              <EmptyState
                title="No school years yet"
                description="Create a school year and mark one as active."
                icon={CalendarRange}
              />
            ) : (
              <ul className="space-y-3">
                {years.map((y) => (
                  <li
                    key={y.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 px-4 py-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{y.label}</span>
                        {y.isActive ? <Badge>Active</Badge> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {y.startDate.toISOString().slice(0, 10)} →{" "}
                        {y.endDate.toISOString().slice(0, 10)}
                      </p>
                    </div>
                    {!isSuperAdminView && !y.isActive ? (
                      <SetActiveYearButton schoolYearId={y.id} />
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
