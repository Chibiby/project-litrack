import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  WEEKLY_WORD_RECOGNITION_LEVEL_LABELS,
  WEEKLY_READING_COMPREHENSION_LEVEL_LABELS,
  readingProfileLabelsForGradeType,
} from "@/lib/constants/enum-labels";
import { EmptyState } from "@/components/dashboard";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { getAralActionWarmHrefs } from "@/lib/nav/warm-hrefs";
import { teacherLearnerScope } from "@/lib/teachers/scope";
import { toDateKey } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface ReadingLevelPageProps {
  params: Promise<{ gradeId: string; id: string }>;
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function ReadingLevelPage({
  params,
  searchParams,
}: ReadingLevelPageProps) {
  const { gradeId, id } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const learnerFilter: Prisma.LearnerWhereInput = isSuperAdmin
    ? { id, deletedAt: null }
    : {
        id,
        schoolId: user.schoolId ?? undefined,
        deletedAt: null,
        ...teacherLearnerScope(user.id),
      };

  const learner = await prisma.learner.findFirst({
    where: learnerFilter,
    include: {
      gradeLevel: { select: { type: true } },
      readingLevels: { orderBy: { weekStart: "desc" }, take: 12 },
    },
  });
  if (!learner) notFound();
  if (learner.gradeLevelId !== gradeId) notFound();

  const readingLabels = readingProfileLabelsForGradeType(learner.gradeLevel.type);
  const nestedWarmHrefs = getAralActionWarmHrefs(gradeId, learner.id);
  const nestedWarmKey = `teacher:aral-action:${learner.id}:nested`;
  const gradeGridHref = sp.schoolId
    ? `/teacher/aral/${gradeId}/reading-level?schoolId=${sp.schoolId}`
    : `/teacher/aral/${gradeId}/reading-level`;

  return (
    <AppShell
      title={`Reading Level — ${learner.fullName}`}
      subtitle={`Weekly reading level history${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <NavPrefetcher cacheKey={nestedWarmKey} hrefs={nestedWarmHrefs} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/aral?grade=${gradeId}`} prefetch={true}>
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href={gradeGridHref}>Grade-wide reading level</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {learner.readingLevels.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No reading-level records yet"
                description="Record weekly levels from the grade-wide reading level page."
                actionHref={gradeGridHref}
                actionLabel="Open grade grid"
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week of</TableHead>
                  <TableHead>English</TableHead>
                  <TableHead>Filipino</TableHead>
                  <TableHead>Word recognition</TableHead>
                  <TableHead>Reading comprehension</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {learner.readingLevels.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">
                      {toDateKey(r.weekStart)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {readingLabels[r.englishProfile]}
                    </TableCell>
                    <TableCell className="text-xs">
                      {readingLabels[r.filipinoProfile]}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.wordRecognitionLevel
                        ? WEEKLY_WORD_RECOGNITION_LEVEL_LABELS[
                            r.wordRecognitionLevel
                          ]
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      {r.readingComprehensionLevel
                        ? WEEKLY_READING_COMPREHENSION_LEVEL_LABELS[
                            r.readingComprehensionLevel
                          ]
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {r.notes ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
