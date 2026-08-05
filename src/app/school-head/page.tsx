import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { CheckCircle2, GraduationCap, UserPlus, ListChecks } from "lucide-react";

export const dynamic = "force-dynamic";

interface SchoolHeadDashboardProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function SchoolHeadDashboard({ searchParams }: SchoolHeadDashboardProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");
  
  // Super Admin can view any school via query param
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
    [grades, teachers, school] = await Promise.all([
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
  } catch (err) {
    // DATABASE_URL missing or Prisma unavailable — degrade to an empty
    // dashboard instead of a 500. requireUser already verified the session.
    console.error("[SchoolHeadDashboard] failed to load data:", err);
  }

  return (
    <AppShell 
      title={isSuperAdmin ? `School: ${school?.name || "Unknown"}` : `Welcome, ${user.firstName}`} 
      subtitle={isSuperAdmin ? "Super Admin View - School Head Dashboard" : "School Head dashboard"}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      isSuperAdminView={isSuperAdmin && !!params.schoolId}
      viewedSchoolName={school?.name}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Profile</CardDescription>
            <CardTitle className="flex items-center gap-2 text-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600" /> Completed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" size="sm" asChild>
              <Link href="/school-head/profiling">Edit profile</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Grade Levels</CardDescription>
            <CardTitle className="text-3xl">{grades.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/school-head/grade-levels"><GraduationCap className="h-4 w-4" /> Manage</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Teachers</CardDescription>
            <CardTitle className="text-3xl">{teachers}</CardTitle>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link href="/school-head/teachers"><UserPlus className="h-4 w-4" /> Invite</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ListChecks className="h-5 w-5" /> Grade levels overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          {grades.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No grade levels yet. <Link href="/school-head/grade-levels" className="underline">Create one →</Link>
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {grades.map((g) => (
                <div key={g.id} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{GRADE_LEVEL_LABELS[g.type]}</span>
                    <Badge variant="secondary">{g._count.teachers} teachers</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{g._count.learners} learners</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
