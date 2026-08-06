import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  DashboardBarChart,
  DashboardLineChart,
} from "@/components/dashboard/simple-charts";
import { getAdminDashboardStats } from "@/lib/dashboard/aggregates";
import {
  School,
  Users,
  Plus,
  ExternalLink,
  Sparkles,
  ScrollText,
  CalendarRange,
  UserCog,
  AlertTriangle,
  GraduationCap,
} from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const user = await requireUser("SUPER_ADMIN");

  let stats: Awaited<ReturnType<typeof getAdminDashboardStats>> | null = null;
  try {
    stats = await getAdminDashboardStats();
  } catch (err) {
    console.error("[AdminDashboard] failed to load stats:", err);
  }

  const hasActivity = (stats?.activityByDay ?? []).some((d) => d.value > 0);
  const hasSchools = (stats?.schoolsTotal ?? 0) > 0;

  return (
    <AppShell
      title="Admin Dashboard"
      subtitle="System-wide overview"
      role={user.role}
      userName={user.fullName || user.email}
    >
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          title="Schools"
          value={stats?.schoolsTotal ?? 0}
          hint={`${stats?.schoolsActive ?? 0} active · ${stats?.schoolsInactive ?? 0} inactive`}
          icon={School}
          tone="primary"
          href="/admin/schools"
        />
        <MetricCard
          title="School Heads"
          value={stats?.schoolHeadCount ?? 0}
          icon={UserCog}
          href="/admin/schools"
        />
        <MetricCard
          title="Teachers"
          value={stats?.teacherCount ?? 0}
          icon={Users}
          href="/admin/schools"
        />
        <MetricCard
          title="Learners"
          value={stats?.learnerCount ?? 0}
          icon={GraduationCap}
          tone="amber"
        />
        <MetricCard
          title="ARAL learners"
          value={stats?.aralCount ?? 0}
          icon={Sparkles}
          tone="violet"
        />
        <MetricCard
          title="Alerts"
          value={stats?.expiredPendingInvites ?? 0}
          hint="Expired pending invites"
          icon={AlertTriangle}
          href="/admin/audit"
        />
      </div>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link href="/admin/schools/new">
            <Plus className="mr-1 h-4 w-4" /> New school
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/audit">
            <ScrollText className="mr-1 h-4 w-4" /> Audit log
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/school-years">
            <CalendarRange className="mr-1 h-4 w-4" /> School years
          </Link>
        </Button>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="School status" description="Active vs inactive schools">
          {!hasSchools ? (
            <EmptyState
              title="No data yet"
              description="Create a school to see status breakdown."
              actionHref="/admin/schools/new"
              actionLabel="New school"
              icon={School}
            />
          ) : (
            <DashboardBarChart data={stats!.schoolStatus} />
          )}
        </ChartCard>
        <ChartCard title="Platform activity (7 days)" description="Audit events per day">
          {!hasActivity ? (
            <EmptyState
              title="No data yet"
              description="Activity trends appear once audited actions are recorded."
              actionHref="/admin/audit"
              actionLabel="View audit"
              icon={ScrollText}
            />
          ) : (
            <DashboardLineChart data={stats!.activityByDay} color="#d97706" />
          )}
        </ChartCard>
      </div>

      {(stats?.schoolsInactive ?? 0) > 0 || (stats?.expiredPendingInvites ?? 0) > 0 ? (
        <Card className="mb-6 border-amber-200/80 bg-amber-50/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              Attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm text-amber-950">
            {(stats?.schoolsInactive ?? 0) > 0 ? (
              <p>{stats!.schoolsInactive} inactive school(s).</p>
            ) : null}
            {(stats?.expiredPendingInvites ?? 0) > 0 ? (
              <p>{stats!.expiredPendingInvites} pending teacher invite(s) expired.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-6 border-amber-200/80 bg-amber-50/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <School className="h-5 w-5 text-primary" />
            School drill-down
          </CardTitle>
          <CardDescription>
            Open a school with <code className="text-xs">?schoolId=</code> — first view per school is audited (once per 8h).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {(stats?.recentSchools ?? []).map((school) => (
              <Button key={school.id} variant="outline" size="sm" asChild className="bg-white">
                <Link href={`/school-head?schoolId=${school.id}`}>
                  {school.name}
                  {!school.isActive ? " (inactive)" : ""}
                  <ExternalLink className="ml-1 h-3 w-3" />
                </Link>
              </Button>
            ))}
            {(stats?.recentSchools ?? []).length === 0 ? (
              <EmptyState
                title="No data yet"
                description="Create a school to enable drill-down."
                actionHref="/admin/schools/new"
                actionLabel="New school"
                icon={School}
                className="w-full border-0 bg-transparent py-6"
              />
            ) : null}
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
