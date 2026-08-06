import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { resolveSchoolContext } from "@/lib/school-context";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { createGradeLevel } from "@/lib/actions/school-head";
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
  if (!user.profileCompleted && user.role !== "SUPER_ADMIN") redirect("/school-head/profiling");

  const { schoolId, isSuperAdminView } = await resolveSchoolContext(
    user,
    params.schoolId,
    "/school-head/grade-levels"
  );

  const [existing, school] = await Promise.all([
    prisma.gradeLevel.findMany({
      where: { schoolId, deletedAt: null },
      select: { type: true, _count: { select: { teachers: true, learners: true } } },
    }),
    prisma.school.findUnique({
      where: { id: schoolId },
      select: { name: true },
    }),
  ]);
  const existingMap = new Map(existing.map((g) => [g.type, g]));

  return (
    <AppShell
      title={isSuperAdminView ? `Grade Levels - ${school?.name || "Unknown"}` : "Grade Levels"}
      subtitle={
        isSuperAdminView
          ? "Super Admin View"
          : "Click any tile to create that grade for your school"
      }
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      schoolName={school?.name}
      isSuperAdminView={isSuperAdminView}
      viewedSchoolName={school?.name}
    >
      <div className="mb-4">
        <Button asChild variant="outline" size="sm">
          <Link
            href={
              isSuperAdminView
                ? `/school-head/sections?schoolId=${schoolId}`
                : "/school-head/sections"
            }
          >
            Manage sections
          </Link>
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
        {ALL_TYPES.map((type) => {
          const has = existingMap.get(type);
          return (
            <Card key={type} className={has ? "border-primary/50" : ""}>
              <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{GRADE_LEVEL_LABELS[type]}</span>
                  {has && <Badge variant="secondary">Active</Badge>}
                </div>
                {has ? (
                  <p className="text-xs text-muted-foreground">
                    {has._count.teachers} teachers · {has._count.learners} learners
                  </p>
                ) : isSuperAdminView ? (
                  <p className="text-xs text-muted-foreground">Not created</p>
                ) : (
                  <form action={createGradeLevel}>
                    <input type="hidden" name="type" value={type} />
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
