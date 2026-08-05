import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isPrismaConnectionError } from "@/lib/auth/app-user";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { DashboardBarChart } from "@/components/dashboard-chart";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { GraduationCap, UserPlus, ListChecks } from "lucide-react";

export const dynamic = "force-dynamic";

interface SchoolHeadDashboardProps {
  searchParams: Promise<{ schoolId?: string }>;
}

function withSchoolId(href: string, schoolId: string | null | undefined, isSuperAdmin: boolean) {
  if (!isSuperAdmin || !schoolId) return href;
  return `${href}?schoolId=${encodeURIComponent(schoolId)}`;
}

export default async function SchoolHeadDashboard({ searchParams }: SchoolHeadDashboardProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const targetSchoolId = isSuperAdmin && params.schoolId ? params.schoolId : user.schoolId;

  if (!user.profileCompleted && !isSuperAdmin) redirect("/school-head/profiling");
  if (!targetSchoolId) redirect("/login");

  type GradeRow = {
    id: string;
    type: keyof typeof GRADE_LEVEL_LABELS;
    _count: { teachers: number; learners: number };
  };

  let grades: GradeRow[] = [];
  let teachers = 0;
  let school: { name: string } | null = null;

  try {
    const result = await Promise.all([
      prisma.gradeLevel.findMany({
        where: { schoolId: targetSchoolId, deletedAt: null },
        include: { _count: { select: { teachers: true, learners: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.user.count({
        where: { schoolId: targetSchoolId, role: "TEACHER", deletedAt: null },
      }),
      prisma.school.findUnique({
        where: { id: targetSchoolId },
        select: { name: true },
      }),
    ]);
    grades = result[0];
    teachers = result[1];
    school = result[2];
  } catch (err) {
    if (isPrismaConnectionError(err)) {
      throw new Error("Database unavailable. Please try again later.");
    }
    throw err;
  }

  const q = (href: string) => withSchoolId(href, targetSchoolId, isSuperAdmin);
  const learnersChart = grades.map((g) => ({
    name: GRADE_LEVEL_LABELS[g.type],
    value: g._count.learners,
  }));

  return (
    <AppShell
      title={isSuperAdmin ? `School: ${school?.name || "Unknown"}` : `Welcome, ${user.firstName}`}
      subtitle={isSuperAdmin ? "Super Admin View - School Head Dashboard" : "School Head dashboard"}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      isSuperAdminView={isSuperAdmin && !!params.schoolId}
      viewedSchoolName={school?.name}
      schoolIdQuery={isSuperAdmin ? targetSchoolId : undefined}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <p className="text-sm text-muted-foreground">Profile</p>
            <CardTitle className="flex items-center gap-2 text-lg">
              <StatusBadge tone="success" label="Completed" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href="/school-head/profiling">Edit profile</Link>
            </Button>
          </CardContent>
        </Card>
        <div className="space-y-3">
          <StatCard label="Grade Levels" value={grades.length} icon={GraduationCap} accent="amber" />
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href={q("/school-head/grade-levels")}>
              <GraduationCap className="h-4 w-4" aria-hidden="true" /> Manage
            </Link>
          </Button>
        </div>
        <div className="space-y-3">
          <StatCard label="Teachers" value={teachers} icon={UserPlus} accent="primary" />
          <Button asChild variant="outline" size="sm" className="w-full">
            <Link href={q("/school-head/teachers")}>
              <UserPlus className="h-4 w-4" aria-hidden="true" /> Invite
            </Link>
          </Button>
        </div>
      </div>

      <div className="mt-6">
        <DashboardBarChart
          title="Learners by grade"
          description="From grade levels already loaded for this school"
          data={learnersChart}
          emptyMessage="No grade levels yet — create one to see learner counts here."
          valueLabel="Learners"
        />
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListChecks className="h-5 w-5" aria-hidden="true" /> Grade levels overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          {grades.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No grade levels yet.{" "}
              <Link href={q("/school-head/grade-levels")} className="underline">
                Create one →
              </Link>
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {grades.map((g) => (
                <div key={g.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{GRADE_LEVEL_LABELS[g.type]}</span>
                    <Badge variant="secondary">{g._count.teachers} teachers</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{g._count.learners} learners</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
