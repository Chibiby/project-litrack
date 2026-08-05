import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/stat-card";
import { DashboardBarChart } from "@/components/dashboard-chart";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { BookOpen, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

interface TeacherDashboardProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function TeacherDashboard({ searchParams }: TeacherDashboardProps) {
  const params = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const targetSchoolId = isSuperAdmin && params.schoolId ? params.schoolId : user.schoolId;

  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");
  if (!targetSchoolId) redirect("/login");

  const gradeFilter = isSuperAdmin
    ? { schoolId: targetSchoolId, deletedAt: null }
    : { schoolId: targetSchoolId, deletedAt: null, teachers: { some: { id: user.id } } };

  const [grades, school] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: gradeFilter,
      include: {
        _count: { select: { learners: { where: { deletedAt: null } } } },
        learners: {
          where: { isAralLearner: true, deletedAt: null },
          select: { id: true },
        },
      },
    }),
    prisma.school.findUnique({
      where: { id: targetSchoolId },
      select: { name: true },
    }),
  ]);

  const sidebarGrades = grades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type],
    hasAral: g.learners.length > 0,
  }));

  const totalLearners = grades.reduce((sum, g) => sum + g._count.learners, 0);
  const totalAral = grades.reduce((sum, g) => sum + g.learners.length, 0);
  const learnersChart = grades.map((g) => ({
    name: GRADE_LEVEL_LABELS[g.type],
    value: g._count.learners,
  }));

  return (
    <AppShell
      title={isSuperAdmin ? `Teacher View - ${school?.name || "Unknown"}` : `Hi, ${user.firstName}`}
      subtitle={isSuperAdmin ? "Super Admin View - All Grade Levels" : "Your assigned grade levels"}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      grades={sidebarGrades}
      isSuperAdminView={isSuperAdmin && !!params.schoolId}
      viewedSchoolName={school?.name}
    >
      {grades.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            You haven&apos;t been assigned to any grade level yet. Ask your School Head.
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard label="Grade levels" value={grades.length} icon={BookOpen} accent="primary" />
            <StatCard label="Learners" value={totalLearners} icon={BookOpen} accent="amber" />
            <StatCard label="ARAL learners" value={totalAral} icon={Sparkles} accent="amber" />
          </div>

          <div className="mb-6">
            <DashboardBarChart
              title="Learners by grade"
              description="From your assigned grade levels"
              data={learnersChart}
              emptyMessage="No learners enrolled in your grades yet."
              valueLabel="Learners"
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {grades.map((g) => (
              <Card key={g.id} className="transition hover:shadow-md">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">{GRADE_LEVEL_LABELS[g.type]}</h3>
                    {g.learners.length > 0 && (
                      <Badge variant="amber">
                        <Sparkles className="h-3 w-3" aria-hidden="true" />
                        {g.learners.length} ARAL
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{g._count.learners} learners</p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm">
                      <Link href={`/teacher/grade/${g.id}`}>Open</Link>
                    </Button>
                    {g.learners.length > 0 && (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/teacher/aral/${g.id}`}>ARAL Dashboard</Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
