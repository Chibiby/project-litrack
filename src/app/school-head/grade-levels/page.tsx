import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { createGradeLevel } from "@/lib/actions/school-head";
import { redirect } from "next/navigation";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

const ALL_TYPES = [
  "KINDER", "G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8", "G9", "G10", "G11", "G12", "FLOATING",
] as const;

interface GradeLevelsPageProps {
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function GradeLevelsPage({ searchParams }: GradeLevelsPageProps) {
  const params = await searchParams;
  const user = await requireUser("SCHOOL_HEAD");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  const targetSchoolId = isSuperAdmin && params.schoolId ? params.schoolId : user.schoolId;

  if (!user.profileCompleted && !isSuperAdmin) redirect("/school-head/profiling");
  if (!targetSchoolId) redirect("/login");

  const [existing, school] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId: targetSchoolId, deletedAt: null },
      select: { type: true, _count: { select: { teachers: true, learners: true } } },
    }),
    prisma.school.findUnique({
      where: { id: targetSchoolId },
      select: { name: true },
    }),
  ]);
  const existingMap = new Map(existing.map((g) => [g.type, g]));

  return (
    <AppShell
      title={isSuperAdmin ? `Grade Levels - ${school?.name || "Unknown"}` : "Grade Levels"}
      subtitle={isSuperAdmin ? "Super Admin View" : "Click any tile to create that grade for your school"}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      isSuperAdminView={isSuperAdmin && !!params.schoolId}
      viewedSchoolName={school?.name}
      schoolIdQuery={isSuperAdmin ? targetSchoolId : undefined}
    >
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-5">
        {ALL_TYPES.map((type) => {
          const has = existingMap.get(type);
          return (
            <Card key={type} className={has ? "border-primary/50" : ""}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{GRADE_LEVEL_LABELS[type]}</span>
                  {has && <Badge variant="secondary">Active</Badge>}
                </div>
                {has ? (
                  <p className="text-xs text-muted-foreground">
                    {has._count.teachers} teachers · {has._count.learners} learners
                  </p>
                ) : (
                  <form action={createGradeLevel}>
                    <input type="hidden" name="type" value={type} />
                    {isSuperAdmin ? (
                      <input type="hidden" name="schoolId" value={targetSchoolId} />
                    ) : null}
                    <Button type="submit" size="sm" variant="outline" className="w-full">
                      <Plus className="h-4 w-4" /> Create
                    </Button>
                  </form>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
