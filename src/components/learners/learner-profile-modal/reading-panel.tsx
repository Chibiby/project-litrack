import { BookOpen } from "lucide-react";
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


  const weeks = learner.readingLevels.map((r) => ({
    id: r.id,
    week: formatDateKey(r.weekStart),
    english: labelOf(readingLabels, r.englishProfile),
    filipino: labelOf(readingLabels, r.filipinoProfile),
    word: labelOf(WEEKLY_WORD_RECOGNITION_LEVEL_LABELS, r.wordRecognitionLevel),
    comprehension: labelOf(WEEKLY_READING_COMPREHENSION_LEVEL_LABELS, r.readingComprehensionLevel),
    notes: r.notes ?? null,
  }));
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
          <div className="overflow-hidden rounded-lg border border-border/80">
            <ResponsiveTable
              table={
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
                    {weeks.map((w) => (
                      <TableRow key={w.id}>
                        <TableCell className="whitespace-nowrap font-medium tabular-nums">{w.week}</TableCell>
                        <TableCell className="text-xs">{w.english}</TableCell>
                        <TableCell className="text-xs">{w.filipino}</TableCell>
                        <TableCell className="text-xs">{w.word}</TableCell>
                        <TableCell className="text-xs">{w.comprehension}</TableCell>
                        <TableCell className="max-w-56 text-xs text-muted-foreground">
                          {w.notes ? <CellText>{w.notes}</CellText> : <NoValue />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              }
              stacked={
                <StackedList aria-label="Weekly reading levels">
                  {weeks.map((w) => (
                    <StackedRow
                      key={w.id}
                      title={`Week of ${w.week}`}
                      meta={
                        <>
                          <span>English: {w.english}</span>
                          <span>Filipino: {w.filipino}</span>
                        </>
                      }
                      details={[
                        { label: "Word recognition", value: w.word },
                        { label: "Reading comprehension", value: w.comprehension },
                        { label: "Notes", value: w.notes || <NoValue /> },
                      ]}
                    />
                  ))}
                </StackedList>
              }
            />
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
