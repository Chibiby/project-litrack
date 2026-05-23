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

export default async function TeacherDashboard() {
  const user = await requireUser("TEACHER");
  if (!user.profileCompleted) redirect("/teacher/profiling");
  if (!user.schoolId) redirect("/login");

  const grades = await prisma.gradeLevel.findMany({
    where: { schoolId: user.schoolId, deletedAt: null, teachers: { some: { id: user.id } } },
    include: {
      _count: { select: { learners: { where: { deletedAt: null } } } },
      learners: {
        where: { isAralLearner: true, deletedAt: null },
        select: { id: true },
      },
    },
  });

  return (
    <AppShell title={`Hi, ${user.firstName}`} subtitle="Your assigned grade levels">
      {grades.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            You haven't been assigned to any grade level yet. Ask your School Head.
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
