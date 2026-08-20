import {
  ArrowLeftRight,
  Bus,
  Cake,
  Globe,
  MapPin,
  User,
} from "lucide-react";
import { LearnerAvatar } from "@/components/learners/learner-avatar";
import {
  DISTANCE_LABELS,
  GENDER_LABELS,
  GOV_BENEFIT_LABELS,
  GRADE_LEVEL_LABELS,
  PARENT_EDUCATION_LABELS,
  TRANSFER_LABELS,
  TRANSPORTATION_LABELS,
  formatEthnicity,
} from "@/lib/constants/enum-labels";
import type { LearnerProfileData } from "@/lib/learners/profile";
import {
  Field,
  FieldGrid,
  InfoCard,
  RailRow,
  StatusPill,
  formatDateKey,
  labelList,
  labelOf,
  orDash,
} from "./parts";

/**
 * Profile tab — the comp's main view: identity rail on the left, three stacked
 * information cards on the right.
 *
 * TRUTH NOTES (the comp draws fields LITRACK has no column for)
 *  - Photo: `Learner` has no photo column, so the circular slot keeps its size
 *    and carries the learner's initials, same as the roster. No camera button —
 *    this dialog is read-only and there is nothing to upload to.
 *  - Nickname, LRN, birthdate, address, guardian name and guardian phone are
 *    not collected. Rather than render six empty rows, each slot carries the
 *    nearest fact LITRACK does hold: the rail's contact block becomes the
 *    learner's Section B travel/transfer facts, and the card's Nickname and LRN
 *    slots become Grade level and Parent's education.
 */

const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  TRANSFERRED: "Transferred",
  ARCHIVED: "Archived",
};

const ENROLLMENT_STATUS_TONE: Record<
  string,
  "positive" | "neutral" | "warning"
> = {
  ACTIVE: "positive",
  COMPLETED: "neutral",
  TRANSFERRED: "warning",
  ARCHIVED: "neutral",
};

export function ProfilePanel({ learner }: { learner: LearnerProfileData }) {
  const gradeLabel =
    GRADE_LEVEL_LABELS[learner.gradeType] ?? learner.gradeType;
  const current = learner.enrollments[0] ?? null;
  const completeName = [learner.firstName, learner.middleName, learner.lastName]
    .filter((part) => part && part.trim())
    .join(" ");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      {/* Identity rail */}
      <div className="flex flex-col items-center gap-4 rounded-xl border border-border/80 bg-muted/30 px-4 py-6 lg:items-start">
        <LearnerAvatar
          id={learner.id}
          fullName={learner.fullName}
          className="size-24 text-2xl lg:self-center"
        />
        <div className="w-full text-center lg:text-center">
          <p className="text-base font-bold leading-tight text-foreground">
            {learner.fullName}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {gradeLabel}
            {learner.sectionName ? ` · ${learner.sectionName}` : ""}
          </p>
          {learner.archivedAt ? (
            <p className="mt-2">
              <StatusPill tone="warning">
                Archived {formatDateKey(learner.archivedAt)}
              </StatusPill>
            </p>
          ) : null}
        </div>

        <div className="w-full space-y-3 border-t border-border/60 pt-4">
          <RailRow icon={User} label="Gender">
            {labelOf(GENDER_LABELS, learner.gender)}
          </RailRow>
          <RailRow icon={Cake} label="Age">
            {learner.age} years old
          </RailRow>
          <RailRow icon={Globe} label="Ethnicity">
            {formatEthnicity(learner.ethnicity, learner.ethnicityOther)}
          </RailRow>
          <RailRow icon={Bus} label="Goes to school by">
            {labelOf(TRANSPORTATION_LABELS, learner.modeOfTransportation)}
          </RailRow>
          <RailRow icon={MapPin} label="Distance from home">
            {labelOf(DISTANCE_LABELS, learner.distanceHomeToSchool)}
          </RailRow>
          <RailRow icon={ArrowLeftRight} label="Previous transfers">
            {labelOf(TRANSFER_LABELS, learner.previousTransfers)}
            {learner.transferDetails ? (
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                {learner.transferDetails}
              </span>
            ) : null}
          </RailRow>
        </div>
      </div>

      {/* Information cards */}
      <div className="space-y-4">
        <InfoCard title="Learner Information">
          <FieldGrid>
            <Field label="Complete name" className="sm:col-span-2">
              {orDash(completeName || learner.fullName)}
            </Field>
            <Field label="Grade level">{gradeLabel}</Field>
            <Field label="Section">{orDash(learner.sectionName)}</Field>
            <Field label="Gender">
              {labelOf(GENDER_LABELS, learner.gender)}
            </Field>
            <Field label="Age">{learner.age}</Field>
            <Field label="Parent's education">
              {labelOf(PARENT_EDUCATION_LABELS, learner.parentEducation)}
            </Field>
            <Field label="Government benefits">
              {labelList(GOV_BENEFIT_LABELS, learner.governmentBenefits)}
            </Field>
          </FieldGrid>
        </InfoCard>

        <InfoCard title="Enrollment Information">
          <FieldGrid>
            <Field label="School year">
              {orDash(current?.schoolYearLabel)}
            </Field>
            <Field label="Status">
              {current ? (
                <StatusPill
                  tone={ENROLLMENT_STATUS_TONE[current.status] ?? "neutral"}
                >
                  {labelOf(ENROLLMENT_STATUS_LABELS, current.status)}
                </StatusPill>
              ) : (
                <StatusPill tone="neutral">Not enrolled</StatusPill>
              )}
            </Field>
            <Field label="Date enrolled">
              {formatDateKey(current?.enrolledAt ?? learner.createdAt)}
            </Field>
            <Field label="Adviser">
              {orDash(current?.teacherName ?? learner.adviserName)}
            </Field>
          </FieldGrid>
        </InfoCard>

        <InfoCard title="Program Information">
          <FieldGrid>
            <Field label="ARAL status">
              {learner.isAralLearner ? (
                <StatusPill tone="positive">Enrolled</StatusPill>
              ) : (
                <StatusPill tone="neutral">Not enrolled</StatusPill>
              )}
            </Field>
            <Field label="ARAL tutor">{orDash(learner.aralTutorName)}</Field>
          </FieldGrid>
        </InfoCard>
      </div>
    </div>
  );
}

/** Shared with the ARAL panel so both agree on enrollment wording. */
export { ENROLLMENT_STATUS_LABELS };
