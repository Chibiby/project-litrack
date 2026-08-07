import Link from "next/link";
import {
  getTeacherMetricCounts,
  getTeacherGradeChart,
  getTeacherGradeCards,
} from "@/lib/dashboard/aggregates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { DashboardBarChart } from "@/components/dashboard/lazy-charts";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  BookOpen,
  ClipboardCheck,
  Sparkles,
  Users,
  AlertCircle,
} from "lucide-react";

type TeacherOpts = {
  schoolId: string;
  teacherId: string;
  isSuperAdmin: boolean;
};

export async function TeacherMetricsSection(opts: TeacherOpts) {
  let metrics: Awaited<ReturnType<typeof getTeacherMetricCounts>> | null =
    null;
  try {
    metrics = await getTeacherMetricCounts(opts);
  } catch (err) {
    console.error("[TeacherMetricsSection] failed to load:", err);
  }

  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Assigned grades"
          value={metrics?.assignedGradeCount ?? 0}
          icon={BookOpen}
          tone="primary"
        />
        <MetricCard
          title="Learners"
          value={metrics?.totalLearners ?? 0}
          icon={Users}
          tone="amber"
        />
        <MetricCard
          title="ARAL learners"
          value={metrics?.aralLearners ?? 0}
          icon={Sparkles}
          tone="violet"
        />
        <MetricCard
          title="Pending ARAL profiles"
          value={metrics?.pendingAralProfiling ?? 0}
          hint="ARAL without Sections B–E"
          icon={AlertCircle}
        />
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <MetricCard
          title="Attendance marks (7d)"
          value={metrics?.attendanceMarked ?? 0}
          icon={ClipboardCheck}
        />
        <MetricCard
          title="Reading records"
          value={metrics?.readingRecords ?? 0}
          icon={BookOpen}
        />
      </div>
    </>
  );
}

export async function TeacherChartSection(opts: TeacherOpts) {
  let gradeBreakdown: Awaited<ReturnType<typeof getTeacherGradeChart>> = [];
  try {
    gradeBreakdown = await getTeacherGradeChart(opts);
  } catch (err) {
    console.error("[TeacherChartSection] failed to load:", err);
  }

  const gradeChart = gradeBreakdown.map((g) => ({
    name:
      GRADE_LEVEL_LABELS[g.name as keyof typeof GRADE_LEVEL_LABELS] ?? g.name,
    value: g.value,
  }));
  const hasGradeData = gradeChart.some((g) => g.value > 0);

  return (
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
  );
}

export async function TeacherGradeCardsSection(opts: TeacherOpts) {
  let gradeCards: Awaited<ReturnType<typeof getTeacherGradeCards>> = [];
  try {
    gradeCards = await getTeacherGradeCards(opts);
  } catch (err) {
    console.error("[TeacherGradeCardsSection] failed to load:", err);
  }

  const pendingGrades = gradeCards.filter((g) => g.needsAralProfiling);

  return (
    <>
      {pendingGrades.length > 0 ? (
        <Card className="mb-6 border-violet-200 bg-violet-50/50">
          <CardHeader>
            <CardTitle className="text-base text-violet-800">
              Quick actions
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {pendingGrades.map((g) => (
              <Button
                key={g.id}
                asChild
                size="sm"
                variant="outline"
                className="bg-white"
              >
                <Link href={`/teacher/aral/${g.id}`}>
                  Complete ARAL profiling — {GRADE_LEVEL_LABELS[g.type]}
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {gradeCards.length === 0 ? (
        <EmptyState
          title="No data yet"
          description="You haven't been assigned to any grade level yet. Ask your School Head."
          icon={BookOpen}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {gradeCards.map((g) => (
            <Card key={g.id} className="transition hover:shadow-md">
              <CardContent className="space-y-3 p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">
                    {GRADE_LEVEL_LABELS[g.type]}
                  </h3>
                  {g.aralCount > 0 ? (
                    <Badge variant="violet">{g.aralCount} ARAL</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-muted-foreground">
                  {g.learnerCount} learners
                </p>
                <div className="flex gap-2">
                  <Button asChild size="sm">
                    <Link href={`/teacher/grade/${g.id}`}>Open</Link>
                  </Button>
                  {g.aralCount > 0 ? (
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/teacher/aral/${g.id}`}>ARAL Dashboard</Link>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
