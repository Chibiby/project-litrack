import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { getSchoolHeadDashboardStats } from "@/lib/dashboard/aggregates";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ChartCard } from "@/components/dashboard/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  DashboardBarChart,
  DashboardLineChart,
} from "@/components/dashboard/simple-charts";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  CheckCircle2,
  GraduationCap,
  UserPlus,
  ListChecks,
  CalendarRange,
  Megaphone,
  Sparkles,
  Layers,
  ClipboardList,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface SchoolHeadDashboardProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function SchoolHeadDashboard({ searchParams }: SchoolHeadDashboardProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");

  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") redirect("/school-head/profiling");

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head"
  );

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true },
  });

  let stats: Awaited<ReturnType<typeof getSchoolHeadDashboardStats>> | null = null;
  try {
    stats = await getSchoolHeadDashboardStats(schoolId);
  } catch (err) {
    console.error("[SchoolHeadDashboard] failed to load data:", err);
  }

  const sh = (path: string) =>
    isSuperAdminView ? `${path}?schoolId=${schoolId}` : path;

  const hasAttendance = (stats?.attendanceTrend ?? []).some((d) => d.value > 0);
  const hasEnDist = (stats?.englishDistribution ?? []).some((d) => d.value > 0);
  const hasFilDist = (stats?.filipinoDistribution ?? []).some((d) => d.value > 0);
  const hasReading = (stats?.readingTrend ?? []).length > 0;

  return (
    <AppShell
      title={isSuperAdminView ? `School: ${school?.name || "Unknown"}` : `Welcome, ${user.firstName}`}
      subtitle={
        isSuperAdminView ? "Super Admin View - School Head Dashboard" : "School Head dashboard"
      }
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={school?.name}
    >
      {!stats?.activeYear ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          No active school year. New learners will not get an Enrollment until you set one.{" "}
          <Link href={sh("/school-head/school-years")} className="font-medium underline">
            Manage school years
          </Link>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          title="Learners"
          value={stats?.learnerCount ?? 0}
          tone="amber"
          icon={ListChecks}
        />
        <MetricCard
          title="Teachers"
          value={stats?.teacherCount ?? 0}
          icon={UserPlus}
          href={sh("/school-head/teachers")}
        />
        <MetricCard
          title="Grades"
          value={stats?.gradeCount ?? 0}
          icon={GraduationCap}
          tone="primary"
          href={sh("/school-head/grade-levels")}
        />
        <MetricCard
          title="Sections"
          value={stats?.sectionCount ?? 0}
          icon={Layers}
          href={sh("/school-head/sections")}
        />
        <MetricCard
          title="ARAL"
          value={stats?.aralCount ?? 0}
          icon={Sparkles}
          tone="violet"
        />
        <MetricCard
          title="School year"
          value={stats?.activeYear?.label ?? "None"}
          hint={stats?.activeYear ? "Active" : "Set an active year"}
          icon={CalendarRange}
          href={sh("/school-head/school-years")}
        />
      </div>

      {(stats?.setupTasks.length ?? 0) > 0 ? (
        <Card className="mb-6 border-amber-200/80 bg-amber-50/40">
          <CardHeader>
            <CardTitle className="text-base">Incomplete setup</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {stats!.setupTasks.map((t) => (
              <Button key={t.id} asChild size="sm" variant="outline" className="bg-white">
                <Link href={isSuperAdminView ? `${t.href}?schoolId=${schoolId}` : t.href}>
                  {t.label}
                </Link>
              </Button>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {!isSuperAdminView ? (
        <div className="mb-6 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline">
            <Link href="/school-head/profiling">
              <CheckCircle2 className="mr-1 h-4 w-4" /> Profile
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/school-head/announcements">
              <Megaphone className="mr-1 h-4 w-4" /> Announcements (
              {stats?.announcements.length ?? 0})
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/school-head/transfer">Transfer learner</Link>
          </Button>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Attendance (last 7 days)" description="Present/late marks recorded">
          {!hasAttendance ? (
            <EmptyState
              title="No data yet"
              description="Attendance trends appear after teachers mark attendance."
              icon={ClipboardList}
            />
          ) : (
            <DashboardLineChart data={stats!.attendanceTrend} />
          )}
        </ChartCard>
        <ChartCard title="Reading progress" description="Monthly reading-level records">
          {!hasReading ? (
            <EmptyState
              title="No data yet"
              description="Progress charts appear after monthly reading records are saved."
              icon={GraduationCap}
            />
          ) : (
            <DashboardBarChart data={stats!.readingTrend} color="#7c3aed" />
          )}
        </ChartCard>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="English reading profiles" description="Current Section A distribution">
          {!hasEnDist ? (
            <EmptyState title="No data yet" description="Add learners to see profile distribution." />
          ) : (
            <DashboardBarChart data={stats!.englishDistribution} height={260} />
          )}
        </ChartCard>
        <ChartCard title="Filipino reading profiles" description="Current Section A distribution">
          {!hasFilDist ? (
            <EmptyState title="No data yet" description="Add learners to see profile distribution." />
          ) : (
            <DashboardBarChart data={stats!.filipinoDistribution} height={260} color="#d97706" />
          )}
        </ChartCard>
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent notices</CardTitle>
          </CardHeader>
          <CardContent>
            {(stats?.announcements.length ?? 0) === 0 ? (
              <EmptyState
                title="No data yet"
                description="Post an announcement for your school."
                actionHref={sh("/school-head/announcements")}
                actionLabel="Announcements"
                icon={Megaphone}
                className="border-0 bg-transparent py-6"
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {stats!.announcements.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2 border-b border-border/60 py-2">
                    <span className="font-medium">{a.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {a.createdAt.toISOString().slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {(stats?.recentAudit.length ?? 0) === 0 ? (
              <EmptyState
                title="No data yet"
                description="Audited school actions will appear here."
                actionHref={sh("/school-head/audit")}
                actionLabel="Audit log"
                className="border-0 bg-transparent py-6"
              />
            ) : (
              <ul className="space-y-2 text-sm">
                {stats!.recentAudit.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2 border-b border-border/60 py-2">
                    <span>
                      <span className="font-medium">{a.action}</span>{" "}
                      <span className="text-muted-foreground">{a.resource}</span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {a.timestamp.toISOString().slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {(stats?.pendingAralProfiles ?? 0) > 0 ? (
              <p className="mt-3 text-xs text-amber-800">
                {stats!.pendingAralProfiles} ARAL learner(s) still need Sections B–E profiling.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListChecks className="h-5 w-5" /> Grade levels
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button asChild size="sm" variant="outline">
            <Link href={sh("/school-head/grade-levels")}>Manage grade levels</Link>
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            Labels use DOCX grade set including Floating ({GRADE_LEVEL_LABELS.FLOATING}).
          </p>
        </CardContent>
      </Card>
    </AppShell>
  );
}
