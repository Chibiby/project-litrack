import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { READING_PROFILE_LABELS } from "@/lib/constants/enum-labels";
import { ReadingLevelForm } from "@/components/forms/reading-level-form";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReadingLevelPage({
  params,
}: {
  params: Promise<{ gradeId: string; id: string }>;
}) {
  const { gradeId, id } = await params;
  const user = await requireUser("TEACHER");
  if (!user.profileCompleted) redirect("/teacher/profiling");

  const learner = await prisma.learner.findFirst({
    where: { id, teacherId: user.id, deletedAt: null },
    include: {
      readingLevels: { orderBy: { monthYear: "desc" }, take: 12 },
    },
  });
  if (!learner) notFound();

  return (
    <AppShell title={`Reading Level — ${learner.fullName}`} subtitle="Monthly reading level records">
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
                  <TableHead>Month</TableHead>
                  <TableHead>English</TableHead>
                  <TableHead>Filipino</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {learner.readingLevels.length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No reading-level records yet</TableCell></TableRow>
                ) : learner.readingLevels.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">{r.monthYear}</TableCell>
                    <TableCell className="text-xs">{READING_PROFILE_LABELS[r.englishProfile]}</TableCell>
                    <TableCell className="text-xs">{READING_PROFILE_LABELS[r.filipinoProfile]}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">{r.notes ?? ""}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <h2 className="font-semibold mb-3">Record reading level</h2>
            <ReadingLevelForm learnerId={learner.id} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
