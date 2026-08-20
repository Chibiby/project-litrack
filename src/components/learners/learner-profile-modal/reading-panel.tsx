import { BookOpen } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/dashboard";
import { ReadingBandPill } from "@/components/learners/reading-band-pill";
import {
  FRUSTRATION_SUBTYPE_LABELS,
  WEEKLY_READING_COMPREHENSION_LEVEL_LABELS,
  WEEKLY_WORD_RECOGNITION_LEVEL_LABELS,
  readingProfileLabelsForGradeType,
} from "@/lib/constants/enum-labels";
import {
  PROFILE_READING_TAKE,
  type LearnerProfileData,
} from "@/lib/learners/profile";
import { Field, FieldGrid, InfoCard, formatDateKey, labelList, labelOf } from "./parts";

/**
 * Reading Level tab — the learner's standing bands first (the number a teacher
 * opens this tab to check), then the weekly history the ARAL grid writes.
 */
export function ReadingPanel({ learner }: { learner: LearnerProfileData }) {
  const readingLabels = readingProfileLabelsForGradeType(learner.gradeType);

  return (
    <div className="space-y-4">
      <InfoCard title="Current reading level">
        <FieldGrid>
          <Field label="English">
            <ReadingBandPill
              profile={learner.englishReadingProfile}
              gradeType={learner.gradeType}
            />
            {learner.englishFrustrationSubtypes.length > 0 ? (
              <span className="mt-1.5 block text-xs font-normal text-muted-foreground">
                {labelList(
                  FRUSTRATION_SUBTYPE_LABELS,
                  learner.englishFrustrationSubtypes
                )}
              </span>
            ) : null}
          </Field>
          <Field label="Filipino">
            <ReadingBandPill
              profile={learner.filipinoReadingProfile}
              gradeType={learner.gradeType}
            />
            {learner.filipinoFrustrationSubtypes.length > 0 ? (
              <span className="mt-1.5 block text-xs font-normal text-muted-foreground">
                {labelList(
                  FRUSTRATION_SUBTYPE_LABELS,
                  learner.filipinoFrustrationSubtypes
                )}
              </span>
            ) : null}
          </Field>
        </FieldGrid>
      </InfoCard>

      {learner.readingLevels.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No reading-level records yet"
          description={
            learner.isAralLearner
              ? "Record reading level from the ARAL reading-level page for this learner."
              : "Reading-level history appears after ARAL updates are recorded."
          }
        />
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            Weekly history
          </p>
          <div className="overflow-x-auto rounded-xl border border-border/80">
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
                    <TableCell className="whitespace-nowrap">
                      {formatDateKey(r.weekStart)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {labelOf(readingLabels, r.englishProfile)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {labelOf(readingLabels, r.filipinoProfile)}
                    </TableCell>
                    <TableCell className="text-xs">
                      {labelOf(
                        WEEKLY_WORD_RECOGNITION_LEVEL_LABELS,
                        r.wordRecognitionLevel
                      )}
                    </TableCell>
                    <TableCell className="text-xs">
                      {labelOf(
                        WEEKLY_READING_COMPREHENSION_LEVEL_LABELS,
                        r.readingComprehensionLevel
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.notes ?? ""}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {learner.readingLevels.length >= PROFILE_READING_TAKE ? (
            <p className="text-xs text-muted-foreground">
              Showing the {PROFILE_READING_TAKE} most recent weeks. Open the full
              profile for the complete history.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
