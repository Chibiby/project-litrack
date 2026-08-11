import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getSchoolName } from "@/lib/cache/school";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  CreateSchoolYearForm,
  SchoolYearsList,
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

  const [years, schoolName] = await Promise.all([
    prisma.schoolYear.findMany({
      where: { schoolId },
      orderBy: { startDate: "desc" },
    }),
    getSchoolName(schoolId),
  ]);

  const active = years.find((y) => y.isActive);

  return (
    <AppShell
      title={isSuperAdminView ? `School Years — ${schoolName ?? ""}` : "School years"}
      subtitle="One active year per school. Learners need an active year for enrollment."
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={schoolName ?? undefined}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={schoolName ?? undefined}
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
              <SchoolYearsList
                readOnly={isSuperAdminView}
                years={years.map((y) => ({
                  id: y.id,
                  label: y.label,
                  startDate: y.startDate.toISOString().slice(0, 10),
                  endDate: y.endDate.toISOString().slice(0, 10),
                  isActive: y.isActive,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
