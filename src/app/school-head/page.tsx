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

export default async function SchoolHeadDashboard() {
  const user = await requireUser("SCHOOL_HEAD");
  if (!user.profileCompleted) redirect("/school-head/profiling");
  if (!user.schoolId) redirect("/login");

  const [grades, teachers] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId: user.schoolId, deletedAt: null },
      include: { _count: { select: { teachers: true, learners: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.count({
      where: { schoolId: user.schoolId, role: "TEACHER", deletedAt: null },
    }),
  ]);

  // Get school name for display
  const school = user.schoolId ? await prisma.school.findUnique({
    where: { id: user.schoolId },
    select: { name: true },
  }) : null;

  return (
    <AppShell 
      title={`Welcome, ${user.firstName}`} 
      subtitle="School Head dashboard"
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
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
