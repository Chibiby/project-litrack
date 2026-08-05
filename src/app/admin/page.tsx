import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { loadAdminDashboardStats } from "@/lib/admin/dashboard-data";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

  return (
    <AppShell
      title="Admin Dashboard"
      subtitle="System-wide overview"
      role={user.role}
      userName={user.fullName || user.email}
    >
      {!dbAvailable ? (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Database is unavailable. Stats and school lists may be empty. Set a valid{" "}
          <code className="text-xs">DATABASE_URL</code> / <code className="text-xs">DIRECT_URL</code>{" "}
          on Vercel (Supabase → Settings → Database), then redeploy.
        </div>
      ) : null}

      {/* Stats Row */}
      <div className="grid gap-4 md:grid-cols-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Schools</CardDescription>
            <CardTitle className="text-3xl">{schoolCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <School className="h-5 w-5 text-primary" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Users</CardDescription>
            <CardTitle className="text-3xl">{userCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Users className="h-5 w-5 text-blue-500" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>ARAL Learners</CardDescription>
            <CardTitle className="text-3xl">{aralCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <Sparkles className="h-5 w-5 text-violet-500" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button asChild size="sm">
              <Link href="/admin/schools/new"><Plus className="h-4 w-4" /> New School</Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/admin/schools">Manage Schools</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Cross-Role Access Section */}
      <Card className="mb-6 border-violet-200 bg-violet-50/50">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-violet-600" />
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
                    className="bg-white"
                  >
                    <Link href={`/school-head?schoolId=${school.id}`}>
                      {school.name}
                      <ExternalLink className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                ))
              )}
            </div>
            <div className="flex gap-2 mt-4">
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

      {/* System Overview */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">System Health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Database</span>
              <span className={dbAvailable ? "text-green-600 font-medium" : "text-amber-600 font-medium"}>
                {dbAvailable ? "Connected" : "Unavailable"}
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Authentication</span>
              <span className="text-green-600 font-medium">Active</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Email Service</span>
              <span className="text-amber-600 font-medium">Not Configured</span>
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
