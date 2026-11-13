import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { AdminPage } from "@/components/admin/admin-page";
import { PageNavLink, PageSlide } from "@/components/ui/page-slide";
import { AdminLearnerEditButton } from "@/components/admin/management/admin-learner-edit";
import { Surface, SurfaceBody, SurfaceHeader } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  CellText,
  NoValue,
} from "@/components/ui/table";
import { ResponsiveTable, StackedList, StackedRow } from "@/components/ui/responsive-table";
import { EmptyState } from "@/components/dashboard/empty-state";
import {
  GENDER_LABELS,
  GRADE_LEVEL_LABELS,
  NUTRITIONAL_STATUS_LABELS,
  PARENT_EDUCATION_LABELS,
  formatEthnicities,
  readingProfileLabelsForGradeType,
} from "@/lib/constants/enum-labels";
import { isIpLearner } from "@/lib/ip/ethnicity";
import { formatLocalDateKey } from "@/lib/date-keys";
import { ADMIN_ROUTES } from "@/lib/routes/admin";

export const dynamic = "force-dynamic";

const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  TRANSFERRED: "Transferred",
  ARCHIVED: "Archived",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-foreground">{children}</dd>
    </div>
  );
}

/**
 * One learner, opened from the division learner directory.
 *
 * Super Admin is division-wide, so the read has no school scope — only the
 * soft-delete filter, matching `updateLearnerAsAdmin`. Edit opens the teacher's
 * learner form in a dialog; placement is shown, not edited.
 */
export default async function AdminLearnerProfilePage({ params }: PageProps) {
  const user = await requireUser("SUPER_ADMIN");
  const { id } = await params;

  const learner = await prisma.learner.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      fullName: true,
      firstName: true,
      middleName: true,
      lastName: true,
      age: true,
      gender: true,
      nutritionalStatus: true,
      ethnicity: true,
      ethnicityOther: true,
      secondaryEthnicity: true,
      secondaryEthnicityOther: true,
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
      isAralLearner: true,
      archivedAt: true,
      gradeLevelId: true,
      gradeLevel: { select: { type: true } },
      section: { select: { name: true } },
      school: { select: { name: true, district: true } },
      teacher: { select: { fullName: true } },
      aralTeacher: { select: { fullName: true } },
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
        take: 20,
      },
    },
  });
  if (!learner) notFound();

  const gradeLabel = GRADE_LEVEL_LABELS[learner.gradeLevel.type] ?? learner.gradeLevel.type;
  const readingLabels = readingProfileLabelsForGradeType(learner.gradeLevel.type);
  const isIp = isIpLearner(learner.ethnicity, learner.secondaryEthnicity);
  const date = (d: Date) => formatLocalDateKey(d);

  return (
    <PageSlide side="child">
      <AdminPage
        title={learner.fullName}
        description={`${gradeLabel}${learner.section ? ` · ${learner.section.name}` : ""} · ${learner.school.name}`}
        role={user.role}
        userName={user.fullName || user.email}
        actions={
          <>
            <Button asChild variant="ghost">
              <PageNavLink dir="back" href={ADMIN_ROUTES.learners}>
                <ArrowLeft aria-hidden className="size-4" /> Back to learners
              </PageNavLink>
            </Button>
            <AdminLearnerEditButton
              learnerName={learner.fullName}
              gradeLevelId={learner.gradeLevelId}
              gradeType={learner.gradeLevel.type}
              placement={{ gradeLabel, sectionName: learner.section?.name ?? null }}
              defaultValues={{
                id: learner.id,
                firstName: learner.firstName,
                middleName: learner.middleName,
                lastName: learner.lastName,
                age: learner.age,
                gender: learner.gender,
                nutritionalStatus: learner.nutritionalStatus,
                ethnicity: learner.ethnicity,
                ethnicityOther: learner.ethnicityOther,
                secondaryEthnicity: learner.secondaryEthnicity,
                secondaryEthnicityOther: learner.secondaryEthnicityOther,
                englishReadingProfile: learner.englishReadingProfile,
                englishFrustrationSubtypes: learner.englishFrustrationSubtypes,
                filipinoReadingProfile: learner.filipinoReadingProfile,
                filipinoFrustrationSubtypes: learner.filipinoFrustrationSubtypes,
                governmentBenefits: learner.governmentBenefits,
                parentEducation: learner.parentEducation,
                modeOfTransportation: learner.modeOfTransportation,
                distanceHomeToSchool: learner.distanceHomeToSchool,
                previousTransfers: learner.previousTransfers,
                transferDetails: learner.transferDetails,
              }}
            />
          </>
        }
      >
        <Surface as="section" className="min-w-0 rounded-lg">
          <SurfaceHeader>
            <h2 className="flex flex-wrap items-center gap-2 text-base font-semibold">
              Profile
              {learner.isAralLearner ? <Badge variant="violet">ARAL</Badge> : null}
              {isIp ? <Badge variant="outline">IP</Badge> : null}
              {learner.archivedAt ? <Badge variant="outline">Removed</Badge> : null}
            </h2>
          </SurfaceHeader>
          <SurfaceBody>
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Name">{learner.fullName}</Field>
              <Field label="Sex">{GENDER_LABELS[learner.gender]}</Field>
              <Field label="Age">{learner.age}</Field>
              <Field label="School">
                {learner.school.name}
                {learner.school.district ? (
                  <span className="block text-xs font-normal text-muted-foreground">
                    {learner.school.district}
                  </span>
                ) : null}
              </Field>
              <Field label="Grade">{gradeLabel}</Field>
              <Field label="Section">{learner.section?.name ?? <NoValue />}</Field>
              <Field label="Adviser">{learner.teacher?.fullName ?? <NoValue />}</Field>
              <Field label="ARAL teacher">
                {learner.isAralLearner ? (learner.aralTeacher?.fullName ?? <NoValue />) : "Not in ARAL"}
              </Field>
              <Field label="Ethnicity">
                {formatEthnicities(
                  learner.ethnicity,
                  learner.ethnicityOther,
                  learner.secondaryEthnicity,
                  learner.secondaryEthnicityOther
                )}
              </Field>
              <Field label="Nutritional status">
                {learner.nutritionalStatus ? NUTRITIONAL_STATUS_LABELS[learner.nutritionalStatus] : <NoValue />}
              </Field>
              <Field label="English reading">
                {learner.englishReadingProfile ? readingLabels[learner.englishReadingProfile] : <NoValue />}
              </Field>
              <Field label="Filipino reading">{readingLabels[learner.filipinoReadingProfile]}</Field>
              <Field label="4Ps beneficiary">
                {learner.governmentBenefits.includes("FOUR_PS") ? "Yes" : "No"}
              </Field>
              <Field label="Parent education">{PARENT_EDUCATION_LABELS[learner.parentEducation]}</Field>
            </dl>
          </SurfaceBody>
        </Surface>

        <Surface as="section" className="min-w-0 rounded-lg">
          <SurfaceHeader>
            <h2 className="text-base font-semibold">Enrollment history</h2>
          </SurfaceHeader>
          {learner.enrollments.length === 0 ? (
            <SurfaceBody>
              <EmptyState
                title="Not enrolled in any school year"
                description="This learner has no enrollment record yet."
              />
            </SurfaceBody>
          ) : (
            <ResponsiveTable
              table={
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">School year</TableHead>
                      <TableHead>Grade</TableHead>
                      <TableHead>Section</TableHead>
                      <TableHead>Teacher</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Enrolled</TableHead>
                      <TableHead className="pr-4">Ended</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {learner.enrollments.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap pl-4 font-medium tabular-nums">
                          {e.schoolYear.label}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {GRADE_LEVEL_LABELS[e.gradeLevel.type]}
                        </TableCell>
                        <TableCell>{e.section?.name ?? <NoValue />}</TableCell>
                        <TableCell className="max-w-56">
                          {e.teacher?.fullName ? <CellText>{e.teacher.fullName}</CellText> : <NoValue />}
                        </TableCell>
                        <TableCell>
                          {e.status === "ACTIVE" ? (
                            <Badge>Active</Badge>
                          ) : (
                            <Badge variant="secondary">{ENROLLMENT_STATUS_LABELS[e.status] ?? e.status}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {date(e.enrolledAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap pr-4 text-xs tabular-nums text-muted-foreground">
                          {e.endedAt ? date(e.endedAt) : <NoValue />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
              stacked={
                <StackedList aria-label="Enrollment history">
                  {learner.enrollments.map((e) => (
                    <StackedRow
                      key={e.id}
                      title={e.schoolYear.label}
                      value={
                        <span className="text-sm font-medium">
                          {GRADE_LEVEL_LABELS[e.gradeLevel.type]}
                          {e.section?.name ? ` · ${e.section.name}` : ""}
                        </span>
                      }
                      state={<span>{ENROLLMENT_STATUS_LABELS[e.status] ?? e.status}</span>}
                      details={[
                        { label: "Teacher", value: e.teacher?.fullName ?? <NoValue /> },
                        { label: "Enrolled", value: date(e.enrolledAt) },
                        { label: "Ended", value: e.endedAt ? date(e.endedAt) : <NoValue /> },
                      ]}
                    />
                  ))}
                </StackedList>
              }
            />
          )}
        </Surface>
      </AdminPage>
    </PageSlide>
  );
}
