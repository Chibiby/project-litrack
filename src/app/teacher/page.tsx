import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

export const dynamic = "force-dynamic";

interface TeacherDashboardProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function TeacherDashboard({ searchParams }: TeacherDashboardProps) {
  const params = await searchParams;
  const user = await requireUser("TEACHER");
  
  // Super Admin can view any school's grades via query param
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const targetSchoolId = isSuperAdmin && params.schoolId ? params.schoolId : user.schoolId;
  
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");
  if (!targetSchoolId) redirect("/login");

  // For Super Admin: show all grades in school; for Teacher: show only assigned grades
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

  // Format grades for sidebar navigation
  const sidebarGrades = grades.map((g) => ({
    id: g.id,
    label: GRADE_LEVEL_LABELS[g.type],
    hasAral: g.learners.length > 0,
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {grades.map((g) => (
            <Card key={g.id} className="hover:shadow-md transition">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-lg">{GRADE_LEVEL_LABELS[g.type]}</h3>
                  {g.learners.length > 0 && (
                    <Badge variant="violet">{g.learners.length} ARAL</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{g._count.learners} learners</p>
                <div className="flex gap-2">
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
      )}
    </AppShell>
  );
}
