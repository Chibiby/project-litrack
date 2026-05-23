import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/constants/enum-labels";
import { AttendanceMarkForm } from "@/components/forms/attendance-mark-form";
import { ArrowLeft } from "lucide-react";
import { getMonday } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function AttendancePage({
  params,
}: {
  params: Promise<{ gradeId: string; id: string }>;
}) {
  const { gradeId, id } = await params;
  const user = await requireUser("TEACHER");
  if (!user.profileCompleted) redirect("/teacher/profiling");

  const learner = await prisma.learner.findFirst({
    where: { id, teacherId: user.id, deletedAt: null },
  });
  if (!learner) notFound();

  // Pull current week's attendance
  const weekStart = getMonday(new Date());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const attendances = await prisma.attendance.findMany({
    where: { learnerId: learner.id, weekStart },
    orderBy: { date: "asc" },
  });

  return (
    <AppShell
      title={`Attendance — ${learner.fullName}`}
      subtitle={`Week of ${weekStart.toLocaleDateString()}`}
    >
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/aral/${gradeId}`}><ArrowLeft className="h-4 w-4" /> Back</Link>
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_360px]">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {attendances.length === 0 ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No attendance recorded this week</TableCell></TableRow>
                ) : attendances.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.date.toLocaleDateString()}</TableCell>
                    <TableCell>{ATTENDANCE_STATUS_LABELS[a.status]}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{a.notes ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="font-semibold mb-3">Mark attendance</h2>
            <AttendanceMarkForm learnerId={learner.id} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
