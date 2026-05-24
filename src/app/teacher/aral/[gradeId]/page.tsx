import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import { ArrowLeft, Edit3, Sparkles } from "lucide-react";

export const dynamic = "force-dynamic";

interface AralDashboardProps {
  params: Promise<{ gradeId: string }>;
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function AralDashboard({ params, searchParams }: AralDashboardProps) {
  const { gradeId } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");
  
  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  // For Super Admin: access any grade; for Teacher: only assigned grades
  const gradeFilter = isSuperAdmin
    ? { id: gradeId, deletedAt: null }
    : { id: gradeId, deletedAt: null, teachers: { some: { id: user.id } } };

  const grade = await prisma.gradeLevel.findFirst({
    where: gradeFilter,
    include: {
      learners: {
        where: { isAralLearner: true, deletedAt: null },
        include: { aralProfile: { select: { id: true, updatedAt: true } } },
        orderBy: { fullName: "asc" },
      },
    },
  });
  if (!grade) notFound();

  return (
    <AppShell
      title={`ARAL Dashboard — ${GRADE_LEVEL_LABELS[grade.type]}`}
      subtitle={`${grade.learners.length} ARAL learner${grade.learners.length === 1 ? "" : "s"}${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/grade/${grade.id}`}><ArrowLeft className="h-4 w-4" /> Back to grade</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Learner</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Profile complete?</TableHead>
                <TableHead>Last update</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grade.learners.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">No ARAL learners.</TableCell></TableRow>
              ) : grade.learners.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium flex items-center gap-2">
                    <Sparkles className="h-3 w-3 text-violet" /> {l.fullName}
                  </TableCell>
                  <TableCell>{l.age}</TableCell>
                  <TableCell>
                    {l.aralProfile ? (
                      <Badge variant="violet">Complete</Badge>
                    ) : (
                      <Badge variant="outline">Pending</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">
                    {l.aralProfile?.updatedAt.toLocaleDateString() ?? "—"}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button asChild size="sm">
                      <Link href={`/teacher/aral/${grade.id}/learners/${l.id}/update`}>
                        <Edit3 className="h-4 w-4" /> Update Data
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/teacher/aral/${grade.id}/learners/${l.id}/attendance`}>Attendance</Link>
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <Link href={`/teacher/aral/${grade.id}/learners/${l.id}/reading-level`}>Reading Level</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
