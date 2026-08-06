import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getTeacherDashboardStats } from "@/lib/dashboard/aggregates";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DashboardBarChart } from "@/components/dashboard/simple-charts";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  BookOpen,
  ClipboardCheck,
  Sparkles,
  Users,
  AlertCircle,
} from "lucide-react";

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

  const school = await prisma.school.findUnique({
    where: { id: targetSchoolId },
    select: { name: true },
  });

  const stats = await getTeacherDashboardStats({
    schoolId: targetSchoolId,
    teacherId: user.id,
    isSuperAdmin,
  });

  const sidebarGrades = stats.grades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type],
    hasAral: g.learners.some((l) => l.isAralLearner),
  }));

  const gradeChart = stats.gradeBreakdown.map((g) => ({
    name: GRADE_LEVEL_LABELS[g.name as keyof typeof GRADE_LEVEL_LABELS] ?? g.name,
    value: g.value,
  }));

  const hasGradeData = gradeChart.some((g) => g.value > 0);

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
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Assigned grades"
          value={stats.grades.length}
          icon={BookOpen}
          tone="primary"
        />
        <MetricCard title="Learners" value={stats.totalLearners} icon={Users} tone="amber" />
        <MetricCard
          title="ARAL learners"
          value={stats.aralLearners}
          icon={Sparkles}
          tone="violet"
        />
        <MetricCard
          title="Pending ARAL profiles"
          value={stats.pendingAralProfiling}
          hint="ARAL without Sections B–E"
          icon={AlertCircle}
        />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <MetricCard
          title="Attendance marks (7d)"
          value={stats.attendanceMarked}
          icon={ClipboardCheck}
        />
        <MetricCard
          title="Reading records"
          value={stats.readingRecords}
          icon={BookOpen}
        />
      </div>

      <div className="mb-6">
        <ChartCard title="Learners by grade" description="Assigned grade levels">
          {!hasGradeData ? (
            <EmptyState
              title="No data yet"
              description="Ask your School Head to assign you to a grade level."
              icon={BookOpen}
            />
          ) : (
            <DashboardBarChart data={gradeChart} />
          )}
        </ChartCard>
      </div>

      {stats.pendingAralProfiling > 0 ? (
        <Card className="mb-6 border-violet-200 bg-violet-50/50">
          <CardHeader>
            <CardTitle className="text-base text-violet-800">Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {stats.grades
              .filter((g) => g.learners.some((l) => l.isAralLearner && !l.aralProfile))
              .map((g) => (
                <Button key={g.id} asChild size="sm" variant="outline" className="bg-white">
                  <Link href={`/teacher/aral/${g.id}`}>
                    Complete ARAL profiling — {GRADE_LEVEL_LABELS[g.type]}
                  </Link>
                </Button>
              ))}
          </CardContent>
        </Card>
      ) : null}

      {stats.grades.length === 0 ? (
        <EmptyState
          title="No data yet"
          description="You haven't been assigned to any grade level yet. Ask your School Head."
          icon={BookOpen}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {stats.grades.map((g) => {
            const aralCount = g.learners.filter((l) => l.isAralLearner).length;
            return (
              <Card key={g.id} className="transition hover:shadow-md">
                <CardContent className="space-y-3 p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">{GRADE_LEVEL_LABELS[g.type]}</h3>
                    {aralCount > 0 ? (
                      <Badge variant="violet">{aralCount} ARAL</Badge>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {g._count.learners} learners
                  </p>
                  <div className="flex gap-2">
                    <Button asChild size="sm">
                      <Link href={`/teacher/grade/${g.id}`}>Open</Link>
                    </Button>
                    {aralCount > 0 ? (
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/teacher/aral/${g.id}`}>ARAL Dashboard</Link>
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
