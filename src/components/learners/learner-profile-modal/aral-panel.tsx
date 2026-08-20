import { Sparkles } from "lucide-react";
import { EmptyState } from "@/components/dashboard";
import {
  ABSENTEEISM_LABELS,
  CLASSROOM_ENV_LABELS,
  FURTHER_ASSESSMENT_LABELS,
  HOME_LITERACY_LABELS,
  INTERVENTION_LABELS,
  LANGUAGE_CONSIDERATION_LABELS,
  LETTER_RECOGNITION_LABELS,
  LETTER_SOUND_LABELS,
  PARENTAL_SUPPORT_LABELS,
  WORD_RECOGNITION_LABELS,
} from "@/lib/constants/enum-labels";
import type { LearnerProfileData } from "@/lib/learners/profile";
import {
  BlockHeading,
  Field,
  FieldGrid,
  InfoCard,
  StatusPill,
  formatDateKey,
  labelList,
  labelOf,
  orDash,
} from "./parts";

/**
 * ARAL Progress tab — program membership, then Sections C–E of the ARAL
 * profile. Same label maps and same section names as the learner detail page.
 *
 * Read-only, including the tutor. Changing the designation is a footer action
 * (Transfer tutor), beside Transfer student — see the direction contract in
 * index.tsx for why it moved out of this panel.
 */
export function AralPanel({ learner }: { learner: LearnerProfileData }) {
  const profile = learner.aralProfile;

  return (
    <div className="space-y-4">
      <InfoCard title="ARAL enrollment">
        <FieldGrid>
          <Field label="Status">
            {learner.isAralLearner ? (
              <StatusPill tone="positive">Enrolled</StatusPill>
            ) : (
              <StatusPill tone="neutral">Not enrolled</StatusPill>
            )}
          </Field>
          <Field label="Date enrolled">
            {formatDateKey(learner.aralEnrolledAt)}
          </Field>
          <Field label="ARAL tutor">{orDash(learner.aralTutorName)}</Field>
        </FieldGrid>
      </InfoCard>

      {!profile ? (
        <EmptyState
          icon={Sparkles}
          title="ARAL profile not completed"
          description="Sections C–E appear here after Update Data is saved on the ARAL dashboard."
        />
      ) : (
        <>
          <InfoCard title="C. Reading behavior">
            <FieldGrid>
              <Field label="Absenteeism">
                {labelOf(ABSENTEEISM_LABELS, profile.absenteeismFrequency)}
                {profile.absenteeismOtherReason ? (
                  <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                    {profile.absenteeismOtherReason}
                  </span>
                ) : null}
              </Field>
              <Field label="Letter recognition">
                {labelOf(LETTER_RECOGNITION_LABELS, profile.letterRecognition)}
              </Field>
              <Field label="Letter-sound correspondence">
                {labelOf(LETTER_SOUND_LABELS, profile.letterSoundCorrespondence)}
              </Field>
              <Field label="Word recognition">
                {labelOf(WORD_RECOGNITION_LABELS, profile.wordRecognition)}
              </Field>
            </FieldGrid>
          </InfoCard>

          <InfoCard title="D. External factors">
            <FieldGrid>
              <Field label="Home literacy">
                {labelOf(
                  HOME_LITERACY_LABELS,
                  profile.homeLiteracyEnvironment
                )}
              </Field>
              <Field label="Parental support">
                {labelOf(PARENTAL_SUPPORT_LABELS, profile.parentalSupport)}
              </Field>
              <Field label="Classroom environment">
                {labelOf(CLASSROOM_ENV_LABELS, profile.classroomEnvironment)}
              </Field>
              <Field label="Language considerations">
                {labelList(
                  LANGUAGE_CONSIDERATION_LABELS,
                  profile.languageConsiderations
                )}
              </Field>
            </FieldGrid>
          </InfoCard>

          <InfoCard title="E. Interventions">
            <div className="space-y-4">
              <div>
                <BlockHeading>Suggested interventions</BlockHeading>
                <p className="text-sm text-foreground">
                  {labelList(
                    INTERVENTION_LABELS,
                    profile.suggestedInterventions
                  )}
                </p>
              </div>
              <FieldGrid>
                <Field label="Further assessment">
                  {labelList(
                    FURTHER_ASSESSMENT_LABELS,
                    profile.furtherAssessment
                  )}
                  {profile.furtherAssessmentOther ? (
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {profile.furtherAssessmentOther}
                    </span>
                  ) : null}
                </Field>
                <Field label="LSEN observations">
                  {orDash(profile.lsenObservations)}
                </Field>
              </FieldGrid>
            </div>
          </InfoCard>
        </>
      )}
    </div>
  );
}
