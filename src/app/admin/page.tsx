import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { loadAdminDashboardStats } from "@/lib/admin/dashboard-data";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { DashboardBarChart } from "@/components/dashboard-chart";
import { School, Users, Plus, GraduationCap, ExternalLink, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const user = await requireUser("SUPER_ADMIN");
  const {
    schoolCount,
    userCount,
    aralCount,
    recentSchools,
    dbAvailable,
  } = await loadAdminDashboardStats();

  const overviewChart = [
    { name: "Schools", value: schoolCount },
    { name: "Users", value: userCount },
    { name: "ARAL", value: aralCount },
  ];

  return (
    <AppShell
      title="Admin Dashboard"
      subtitle="System-wide overview"
      role={user.role}
      userName={user.fullName || user.email}
    >
      {!dbAvailable ? (
        <div className="mb-6 rounded-lg border border-border bg-amber-muted px-4 py-3 text-sm text-amber-foreground">
          Database is unavailable. Stats and school lists may be empty. Set a valid{" "}
          <code className="text-xs">DATABASE_URL</code> / <code className="text-xs">DIRECT_URL</code>{" "}
          on Vercel (Supabase → Settings → Database), then redeploy.
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Schools" value={schoolCount} icon={School} accent="amber" />
        <StatCard label="Total Users" value={userCount} icon={Users} accent="primary" />
        <StatCard label="ARAL Learners" value={aralCount} icon={Sparkles} accent="amber" />
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button asChild size="sm">
              <Link href="/admin/schools/new">
                <Plus className="h-4 w-4" aria-hidden="true" /> New School
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/schools">Manage Schools</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6">
        <DashboardBarChart
          title="System totals"
          description="Counts already loaded for this dashboard"
          data={overviewChart}
          emptyMessage="No system totals available yet. Create a school to get started."
          valueLabel="Total"
        />
      </div>

      <Card className="mb-6 border-border bg-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <GraduationCap className="h-5 w-5 text-primary" aria-hidden="true" />
            Access School Data
          </CardTitle>
          <CardDescription>
            As Super Admin, you can view and manage any school&apos;s data directly
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Recent schools:</p>
            <div className="flex flex-wrap gap-2">
              {recentSchools.length === 0 ? (
                <p className="text-sm text-muted-foreground">No schools to show yet.</p>
              ) : (
                recentSchools.map((school) => (
                  <Button
                    key={school.id}
                    variant="outline"
                    size="sm"
                    asChild
                    className="bg-card"
                  >
                    <Link href={`/school-head?schoolId=${school.id}`}>
                      {school.name}
                      <ExternalLink className="ml-1 h-3 w-3" aria-hidden="true" />
                    </Link>
                  </Button>
                ))
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge variant="outline" className="text-xs">
                View Grade Levels
              </Badge>
              <Badge variant="outline" className="text-xs">
                View Teachers
              </Badge>
              <Badge variant="outline" className="text-xs">
                View Learners
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Database</span>
              <StatusBadge
                tone={dbAvailable ? "success" : "warning"}
                label={dbAvailable ? "Connected" : "Unavailable"}
              />
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Authentication</span>
              <StatusBadge tone="success" label="Active" />
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Email Service</span>
              <StatusBadge tone="warning" label="Not Configured" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Navigation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
              <Link href="/school-head/grade-levels">Grade Levels</Link>
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
              <Link href="/school-head/teachers">Teachers</Link>
            </Button>
            <Button variant="ghost" size="sm" className="w-full justify-start" asChild>
              <Link href="/teacher">Teacher Dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
