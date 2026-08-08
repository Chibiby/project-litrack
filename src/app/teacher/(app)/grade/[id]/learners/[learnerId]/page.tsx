import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/dashboard";
import {
  GRADE_LEVEL_LABELS,
  READING_PROFILE_LABELS,
  GENDER_LABELS,
  PARENT_EDUCATION_LABELS,
  GOV_BENEFIT_LABELS,
  FRUSTRATION_SUBTYPE_LABELS,
  ATTENDANCE_STATUS_LABELS,
  INTERVENTION_LABELS,
  FURTHER_ASSESSMENT_LABELS,
} from "@/lib/constants/enum-labels";
import { LearnerArchiveButton } from "@/components/learners/learner-archive-button";
import { AralToggleButton } from "@/components/aral-toggle-button";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { getLearnerDetailWarmHrefs } from "@/lib/nav/warm-hrefs";
import { ArrowLeft, Pencil } from "lucide-react";

export const dynamic = "force-dynamic";

const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  TRANSFERRED: "Transferred",
  ARCHIVED: "Archived",
};

interface LearnerDetailPageProps {
  params: Promise<{ id: string; learnerId: string }>;
  searchParams: Promise<{ schoolId?: string }>;
}

export default async function LearnerDetailPage({
  params,
  searchParams,
}: LearnerDetailPageProps) {
  const { id: gradeId, learnerId } = await params;
  const sp = await searchParams;
  const user = await requireUser("TEACHER");

  const isSuperAdmin = user.role === "SUPER_ADMIN";
  if (!user.profileCompleted && !isSuperAdmin) redirect("/teacher/profiling");

  const learnerFilter = isSuperAdmin
    ? { id: learnerId, deletedAt: null }
    : { id: learnerId, teacherId: user.id, deletedAt: null };

  const learner = await prisma.learner.findFirst({
    where: learnerFilter,
    include: {
      section: { select: { name: true } },
      gradeLevel: { select: { id: true, type: true } },
      enrollments: {
        include: {
          schoolYear: { select: { label: true } },
          gradeLevel: { select: { type: true } },
          section: { select: { name: true } },
          teacher: { select: { fullName: true } },
        },
        orderBy: { enrolledAt: "desc" },
      },
      attendances: {
        orderBy: { date: "desc" },
        take: 60,
      },
      readingLevels: {
        orderBy: { monthYear: "desc" },
        take: 24,
      },
      aralProfile: true,
    },
  });
  if (!learner) notFound();
  if (learner.gradeLevelId !== gradeId) notFound();

  const attendanceByWeek = new Map<string, typeof learner.attendances>();
  for (const a of learner.attendances) {
    const key = a.weekStart.toISOString().slice(0, 10);
    const list = attendanceByWeek.get(key) ?? [];
    list.push(a);
    attendanceByWeek.set(key, list);
  }

  const interventions = learner.aralProfile?.suggestedInterventions ?? [];
  const further = learner.aralProfile?.furtherAssessment ?? [];
  const nestedWarmHrefs = getLearnerDetailWarmHrefs(gradeId, learner);
  const nestedWarmKey = `teacher:learner:${learner.id}:nested:${nestedWarmHrefs.join("|")}`;

  return (
    <AppShell
      title={learner.fullName}
      subtitle={`${GRADE_LEVEL_LABELS[learner.gradeLevel.type]}${learner.section ? ` · ${learner.section.name}` : ""}${isSuperAdmin && sp.schoolId ? " (Admin View)" : ""}`}
      role={user.role}
      userName={user.fullName || `${user.firstName} ${user.lastName}`}
      isSuperAdminView={isSuperAdmin && !!sp.schoolId}
    >
      <NavPrefetcher cacheKey={nestedWarmKey} hrefs={nestedWarmHrefs} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/teacher/grade/${gradeId}`}>
            <ArrowLeft className="h-4 w-4" /> Back to grade
          </Link>
        </Button>
        {!isSuperAdmin && (
          <div className="flex flex-wrap gap-2">
            {!learner.archivedAt && (
              <>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/teacher/grade/${gradeId}/learners/${learner.id}/edit`}>
                    <Pencil className="h-4 w-4" /> Edit
                  </Link>
                </Button>
                <AralToggleButton
                  learnerId={learner.id}
                  isAral={learner.isAralLearner}
                />
              </>
            )}
            <LearnerArchiveButton
              learnerId={learner.id}
              archived={Boolean(learner.archivedAt)}
            />
          </div>
        )}
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              Section A — Profile
              {learner.isAralLearner && <Badge variant="violet">ARAL</Badge>}
              {learner.archivedAt && <Badge variant="outline">Archived</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            <div>
              <p className="text-muted-foreground">Name</p>
              <p className="font-medium">{learner.fullName}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Age / Gender</p>
              <p className="font-medium">
                {learner.age} · {GENDER_LABELS[learner.gender]}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">English reading</p>
              <p className="font-medium">
                {READING_PROFILE_LABELS[learner.englishReadingProfile]}
              </p>
              {learner.englishFrustrationSubtypes.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {learner.englishFrustrationSubtypes
                    .map((s) => FRUSTRATION_SUBTYPE_LABELS[s])
                    .join("; ")}
                </p>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">Filipino reading</p>
              <p className="font-medium">
                {READING_PROFILE_LABELS[learner.filipinoReadingProfile]}
              </p>
              {learner.filipinoFrustrationSubtypes.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {learner.filipinoFrustrationSubtypes
                    .map((s) => FRUSTRATION_SUBTYPE_LABELS[s])
                    .join("; ")}
                </p>
              )}
            </div>
            <div>
              <p className="text-muted-foreground">Government benefits</p>
              <p className="font-medium">
                {learner.governmentBenefits.length
                  ? learner.governmentBenefits
                      .map((b) => GOV_BENEFIT_LABELS[b])
                      .join(", ")
                  : "None"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Parent education</p>
              <p className="font-medium">
                {PARENT_EDUCATION_LABELS[learner.parentEducation]}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Enrollment history</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {learner.enrollments.length === 0 ? (
              <div className="p-4">
                <EmptyState title="No enrollment history yet" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>School year</TableHead>
                    <TableHead>Grade</TableHead>
                    <TableHead>Section</TableHead>
                    <TableHead>Teacher</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Enrolled</TableHead>
                    <TableHead>Ended</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {learner.enrollments.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.schoolYear.label}</TableCell>
                      <TableCell>
                        {GRADE_LEVEL_LABELS[e.gradeLevel.type]}
                      </TableCell>
                      <TableCell>{e.section?.name ?? "—"}</TableCell>
                      <TableCell>{e.teacher?.fullName ?? "—"}</TableCell>
                      <TableCell>
                        {ENROLLMENT_STATUS_LABELS[e.status] ?? e.status}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.enrolledAt.toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {e.endedAt?.toLocaleDateString() ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Attendance history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {attendanceByWeek.size === 0 ? (
              <EmptyState
                title="No attendance records yet"
                description={
                  learner.isAralLearner
                    ? "Mark attendance from the ARAL attendance page for this learner."
                    : "Attendance history appears after ARAL attendance is recorded."
                }
              />
            ) : (
              Array.from(attendanceByWeek.entries()).map(([week, rows]) => (
                <div key={week}>
                  <p className="mb-2 text-sm font-medium text-muted-foreground">
                    Week of {new Date(week).toLocaleDateString()}
                  </p>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>{a.date.toLocaleDateString()}</TableCell>
                          <TableCell>
                            {ATTENDANCE_STATUS_LABELS[a.status]}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {a.notes ?? ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Reading-level history</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {learner.readingLevels.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="No reading-level records yet"
                  description={
                    learner.isAralLearner
                      ? "Record reading level from the ARAL reading-level page for this learner."
                      : "Reading-level history appears after ARAL updates are recorded."
                  }
                />
              </div>
            ) : (
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
                  {learner.readingLevels.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">{r.monthYear}</TableCell>
                      <TableCell className="text-xs">
                        {READING_PROFILE_LABELS[r.englishProfile]}
                      </TableCell>
                      <TableCell className="text-xs">
                        {READING_PROFILE_LABELS[r.filipinoProfile]}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {r.notes ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Interventions</CardTitle>
          </CardHeader>
          <CardContent>
            {!learner.aralProfile ||
            (interventions.length === 0 && further.length === 0) ? (
              <EmptyState
                title="No interventions recorded"
                description="ARAL Section E appears here after UPDATE DATA is completed."
              />
            ) : (
              <div className="space-y-3 text-sm">
                {interventions.length > 0 && (
                  <div>
                    <p className="text-muted-foreground mb-1">Suggested</p>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {interventions.map((i) => (
                        <li key={i}>{INTERVENTION_LABELS[i]}</li>
                      ))}
                    </ul>
                    {learner.aralProfile.lsenObservations && (
                      <p className="mt-2 text-muted-foreground">
                        LSEN notes: {learner.aralProfile.lsenObservations}
                      </p>
                    )}
                  </div>
                )}
                {further.length > 0 && (
                  <div>
                    <p className="text-muted-foreground mb-1">
                      Further assessment
                    </p>
                    <ul className="list-disc pl-5 space-y-0.5">
                      {further.map((f) => (
                        <li key={f}>{FURTHER_ASSESSMENT_LABELS[f]}</li>
                      ))}
                    </ul>
                    {learner.aralProfile.furtherAssessmentOther && (
                      <p className="mt-2 text-muted-foreground">
                        Other: {learner.aralProfile.furtherAssessmentOther}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
