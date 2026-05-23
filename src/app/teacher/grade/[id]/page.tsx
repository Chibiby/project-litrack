import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GRADE_LEVEL_LABELS, READING_PROFILE_LABELS, GENDER_LABELS } from "@/lib/constants/enum-labels";
import { LearnerForm } from "@/components/forms/learner-form";
import { AralToggleButton } from "@/components/aral-toggle-button";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TeacherGradePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser("TEACHER");
  if (!user.profileCompleted) redirect("/teacher/profiling");

  const grade = await prisma.gradeLevel.findFirst({
    where: { id, deletedAt: null, teachers: { some: { id: user.id } } },
    include: {
      learners: {
        where: { deletedAt: null },
        orderBy: { fullName: "asc" },
      },
    },
  });
  if (!grade) notFound();

  const aralCount = grade.learners.filter((l) => l.isAralLearner).length;

  return (
    <AppShell title={GRADE_LEVEL_LABELS[grade.type]} subtitle={`${grade.learners.length} learners · ${aralCount} ARAL`}>
      <div className="mb-4 flex items-center justify-between">
        <Button asChild variant="ghost" size="sm">
          <Link href="/teacher"><ArrowLeft className="h-4 w-4" /> Back</Link>
        </Button>
        {aralCount > 0 && (
          <Button asChild variant="outline">
            <Link href={`/teacher/aral/${grade.id}`}>Open ARAL Dashboard</Link>
          </Button>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>English</TableHead>
                  <TableHead>Filipino</TableHead>
                  <TableHead className="text-right">ARAL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {grade.learners.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No learners yet. Add one →</TableCell></TableRow>
                ) : grade.learners.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="font-medium">{l.fullName}</TableCell>
                    <TableCell>{l.age}</TableCell>
                    <TableCell>{GENDER_LABELS[l.gender]}</TableCell>
                    <TableCell className="text-xs">{READING_PROFILE_LABELS[l.englishReadingProfile]}</TableCell>
                    <TableCell className="text-xs">{READING_PROFILE_LABELS[l.filipinoReadingProfile]}</TableCell>
                    <TableCell className="text-right">
                      <AralToggleButton learnerId={l.id} isAral={l.isAralLearner} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="font-semibold mb-3">Add new learner</h2>
            <LearnerForm gradeLevelId={grade.id} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
