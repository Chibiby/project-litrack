import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
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
  GENDER_LABELS,
  ETHNICITY_LABELS,
  PARENT_EDUCATION_LABELS,
  FRUSTRATION_SUBTYPE_LABELS,
  TRANSPORTATION_LABELS,
  DISTANCE_LABELS,
  TRANSFER_LABELS,
  ATTENDANCE_STATUS_LABELS,
  ABSENTEEISM_LABELS,
  LETTER_RECOGNITION_LABELS,
  LETTER_SOUND_LABELS,
  WORD_RECOGNITION_LABELS,
  WEEKLY_WORD_RECOGNITION_LEVEL_LABELS,
  WEEKLY_READING_COMPREHENSION_LEVEL_LABELS,
  HOME_LITERACY_LABELS,
  PARENTAL_SUPPORT_LABELS,
  CLASSROOM_ENV_LABELS,
  LANGUAGE_CONSIDERATION_LABELS,
  INTERVENTION_LABELS,
  FURTHER_ASSESSMENT_LABELS,
  readingProfileLabelsForGradeType,
} from "@/lib/constants/enum-labels";
import { LearnerArchiveButton } from "@/components/learners/learner-archive-button";
import { NavPrefetcher } from "@/components/nav-prefetcher";
import { getLearnerDetailWarmHrefs } from "@/lib/nav/warm-hrefs";
import { teacherLearnerScope } from "@/lib/teachers/scope";
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

function formatWeekStart(date: Date) {
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
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

  const learnerFilter: Prisma.LearnerWhereInput = isSuperAdmin
    ? { id: learnerId, deletedAt: null }
    : {
        id: learnerId,
        schoolId: user.schoolId ?? undefined,
        deletedAt: null,
        ...teacherLearnerScope(user.id),
      };

  const learner = await prisma.learner.findFirst({
    where: learnerFilter,
    select: {
      id: true,
      fullName: true,
      age: true,
      gender: true,
      ethnicity: true,
      ethnicityOther: true,
      gradeLevelId: true,
      isAralLearner: true,
      archivedAt: true,
      englishReadingProfile: true,
      englishFrustrationSubtypes: true,
      filipinoReadingProfile: true,
      filipinoFrustrationSubtypes: true,
      governmentBenefits: true,
      parentEducation: true,
      modeOfTransportation: true,
      distanceHomeToSchool: true,
      previousTransfers: true,
      transferDetails: true,
      section: { select: { name: true } },
      gradeLevel: { select: { id: true, type: true } },
      enrollments: {
        select: {
          id: true,
          status: true,
          enrolledAt: true,
          endedAt: true,
          schoolYear: { select: { label: true } },
          gradeLevel: { select: { type: true } },
          section: { select: { name: true } },
          teacher: { select: { fullName: true } },
        },
        orderBy: { enrolledAt: "desc" },
        take: 12,
      },
      attendances: {
        select: {
          id: true,
          date: true,
          weekStart: true,
          status: true,
          notes: true,
        },
        orderBy: { date: "desc" },
        take: 20,
      },
      readingLevels: {
        select: {
          id: true,
          weekStart: true,
          englishProfile: true,
          filipinoProfile: true,
          wordRecognitionLevel: true,
          readingComprehensionLevel: true,
          notes: true,
        },
        orderBy: { weekStart: "desc" },
        take: 12,
      },
      aralProfile: {
        select: {
          absenteeismFrequency: true,
          absenteeismOtherReason: true,
          letterRecognition: true,
          letterSoundCorrespondence: true,
          wordRecognition: true,
          homeLiteracyEnvironment: true,
          parentalSupport: true,
          classroomEnvironment: true,
          languageConsiderations: true,
          suggestedInterventions: true,
          furtherAssessment: true,
          lsenObservations: true,
          furtherAssessmentOther: true,
        },
      },
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

  const profile = learner.aralProfile;
  const interventions = profile?.suggestedInterventions ?? [];
  const further = profile?.furtherAssessment ?? [];
  const languages = profile?.languageConsiderations ?? [];
  const readingLabels = readingProfileLabelsForGradeType(
    learner.gradeLevel.type
  );
  const nestedWarmHrefs = getLearnerDetailWarmHrefs(gradeId, learner);
  const nestedWarmKey = `teacher:learner:${learner.id}:nested:${nestedWarmHrefs.join("|")}`;

  const hasSectionB =
    learner.modeOfTransportation != null ||
    learner.distanceHomeToSchool != null ||
    learner.previousTransfers != null;

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
          <Link href={`/teacher/learners?grade=${gradeId}`}>
            <ArrowLeft className="h-4 w-4" /> Back to learners
          </Link>
        </Button>
        {!isSuperAdmin && (
          <div className="flex flex-wrap gap-2">
            {!learner.archivedAt && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/teacher/grade/${gradeId}/learners/${learner.id}/edit`}>
                  <Pencil className="h-4 w-4" /> Edit
                </Link>
              </Button>
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
              <p className="text-muted-foreground">Ethnicity</p>
              <p className="font-medium">
                {learner.ethnicity
                  ? learner.ethnicity === "OTHER"
                    ? (learner.ethnicityOther ?? ETHNICITY_LABELS.OTHER)
                    : ETHNICITY_LABELS[learner.ethnicity]
                  : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">English reading</p>
              <p className="font-medium">
                {readingLabels[learner.englishReadingProfile]}
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
                {readingLabels[learner.filipinoReadingProfile]}
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
              <p className="text-muted-foreground">4Ps beneficiary</p>
              <p className="font-medium">
                {learner.governmentBenefits.includes("FOUR_PS") ? "Yes" : "No"}
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
            <CardTitle className="text-base">
              Section B — Attendance &amp; School Background
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            {!hasSectionB ? (
              <div className="sm:col-span-2">
                <EmptyState
                  title="No Section B data yet"
                  description="Add transportation, distance, and transfer details when editing this learner."
                />
              </div>
            ) : (
              <>
                <div>
                  <p className="text-muted-foreground">Mode of transportation</p>
                  <p className="font-medium">
                    {learner.modeOfTransportation
                      ? TRANSPORTATION_LABELS[learner.modeOfTransportation]
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Distance home to school</p>
                  <p className="font-medium">
                    {learner.distanceHomeToSchool
                      ? DISTANCE_LABELS[learner.distanceHomeToSchool]
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Previous school transfers</p>
                  <p className="font-medium">
                    {learner.previousTransfers
                      ? TRANSFER_LABELS[learner.previousTransfers]
                      : "—"}
                  </p>
                  {learner.transferDetails && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {learner.transferDetails}
                    </p>
                  )}
                </div>
              </>
            )}
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

        {learner.isAralLearner || profile ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                ARAL profile — Sections C, D, E
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 text-sm">
              {!profile ? (
                <EmptyState
                  title="ARAL profile not completed"
                  description="Sections C–E appear here after Update Data is saved on the ARAL dashboard."
                />
              ) : (
                <>
                  <div>
                    <p className="font-medium mb-2">C. Reading Behavior</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-muted-foreground">Absenteeism</p>
                        <p className="font-medium">
                          {ABSENTEEISM_LABELS[profile.absenteeismFrequency]}
                        </p>
                        {profile.absenteeismOtherReason && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {profile.absenteeismOtherReason}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-muted-foreground">Letter recognition</p>
                        <p className="font-medium">
                          {LETTER_RECOGNITION_LABELS[profile.letterRecognition]}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">
                          Letter-sound correspondence
                        </p>
                        <p className="font-medium">
                          {LETTER_SOUND_LABELS[profile.letterSoundCorrespondence]}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Word recognition</p>
                        <p className="font-medium">
                          {WORD_RECOGNITION_LABELS[profile.wordRecognition]}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="font-medium mb-2">D. External Factors</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <p className="text-muted-foreground">Home literacy</p>
                        <p className="font-medium">
                          {HOME_LITERACY_LABELS[profile.homeLiteracyEnvironment]}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Parental support</p>
                        <p className="font-medium">
                          {PARENTAL_SUPPORT_LABELS[profile.parentalSupport]}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Classroom environment</p>
                        <p className="font-medium">
                          {CLASSROOM_ENV_LABELS[profile.classroomEnvironment]}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Language considerations</p>
                        <p className="font-medium">
                          {languages.length
                            ? languages
                                .map((l) => LANGUAGE_CONSIDERATION_LABELS[l])
                                .join("; ")
                            : "—"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="font-medium mb-2">
                      E. Interventions &amp; Recommendations
                    </p>
                    {interventions.length === 0 && further.length === 0 ? (
                      <p className="text-muted-foreground">None recorded</p>
                    ) : (
                      <div className="space-y-3">
                        {interventions.length > 0 && (
                          <div>
                            <p className="text-muted-foreground mb-1">Suggested</p>
                            <ul className="list-disc pl-5 space-y-0.5">
                              {interventions.map((i) => (
                                <li key={i}>{INTERVENTION_LABELS[i]}</li>
                              ))}
                            </ul>
                            {profile.lsenObservations && (
                              <p className="mt-2 text-muted-foreground">
                                LSEN notes: {profile.lsenObservations}
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
                            {profile.furtherAssessmentOther && (
                              <p className="mt-2 text-muted-foreground">
                                Other: {profile.furtherAssessmentOther}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ) : null}

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
                    Week of {formatWeekStart(new Date(week))}
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
                      <TableCell>{formatWeekStart(r.weekStart)}</TableCell>
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
      </div>
    </AppShell>
  );
}
