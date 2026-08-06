"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FieldText, FieldRadioGroup, FieldCheckboxList, FieldReadOnlyEmail } from "./profile-shared";
import {
  TEACHER_POSITION_LABELS,
  EDUCATIONAL_ATTAINMENT_LABELS,
  SPECIALIZATION_LABELS,
  YEARS_IN_SERVICE_LABELS,
  TRAINING_LEVEL_LABELS,
  READING_TRAINING_LABELS,
  ENGLISH_TRAINING_LABELS,
  SUBJECT_LABELS,
  GRADE_LEVEL_LABELS,
  toOptions,
} from "@/lib/constants/enum-labels";
import { saveTeacherProfile } from "@/lib/actions/teacher";

const DESIGNATION_OPTIONS = [
  { value: "Teacher", label: "Teacher" },
  { value: "Master Teacher", label: "Master Teacher" },
  { value: "School Head", label: "School Head" },
  { value: "__OTHER__", label: "Others" },
];

type Defaults = Partial<{
  accountEmail: string;
  accountEmailIsSynthetic: boolean;
  contactNumber: string | null;
  contactEmail: string | null;
  designation: string | null;
  position: string;
  educationalAttainment: string;
  fieldOfSpecialization: string;
  specializationOther: string | null;
  yearsInService: string;
  currentGradeAssignment: string | null;
  mostSubjectHandled: string;
  hasReadingTraining: boolean;
  readingTrainings: string[];
  hasEnglishTraining: boolean;
  englishTrainings: string[];
  highestTrainingLevel: string;
}>;

function resolveDesignationChoice(raw?: string | null): { choice: string; other: string } {
  if (!raw) return { choice: "", other: "" };
  const known = DESIGNATION_OPTIONS.find((o) => o.value === raw && o.value !== "__OTHER__");
  if (known) return { choice: known.value, other: "" };
  return { choice: "__OTHER__", other: raw };
}

export function TeacherProfileForm({ defaultValues }: { defaultValues: Defaults }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const initialDesig = resolveDesignationChoice(defaultValues.designation);
  const [designationChoice, setDesignationChoice] = useState(initialDesig.choice);
  const [specialization, setSpecialization] = useState(defaultValues.fieldOfSpecialization ?? "");
  const [hasReading, setHasReading] = useState(
    defaultValues.hasReadingTraining === undefined
      ? ""
      : defaultValues.hasReadingTraining
        ? "true"
        : "false"
  );
  const [hasEnglish, setHasEnglish] = useState(
    defaultValues.hasEnglishTraining === undefined
      ? ""
      : defaultValues.hasEnglishTraining
        ? "true"
        : "false"
  );

  return (
    <form
      action={(fd) => {
        if (designationChoice === "__OTHER__") {
          // designation text field already in form
        } else if (designationChoice) {
          fd.set("designation", designationChoice);
        }
        if (specialization !== "OTHERS") fd.delete("specializationOther");
        if (hasReading !== "true") {
          fd.delete("readingTrainings[]");
        }
        if (hasEnglish !== "true") {
          fd.delete("englishTrainings[]");
        }
        startTransition(async () => {
          const res = await saveTeacherProfile(fd);
          if (res.ok) {
            toast.success("Profile saved");
            router.push("/teacher");
          } else toast.error(res.error);
        });
      }}
      className="space-y-6"
    >
      <Card>
        <CardHeader><CardTitle className="text-base">I. Respondent Information</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FieldReadOnlyEmail
              label="Account email (login)"
              value={defaultValues.accountEmail ?? ""}
              hint={
                defaultValues.accountEmailIsSynthetic
                  ? "Synthetic login identity — not used for email recovery. Enter a real contact email below for the survey."
                  : "Login email is managed separately from survey contact email."
              }
            />
            <FieldText
              name="contactEmail"
              label="Email address (contact)"
              type="email"
              defaultValue={defaultValues.contactEmail ?? ""}
            />
            <FieldText name="contactNumber" label="Contact number" defaultValue={defaultValues.contactNumber ?? ""} />
            <div className="space-y-2">
              <p className="text-sm font-medium">Designation (optional)</p>
              <FieldRadioGroup
                name="_designationChoice"
                options={DESIGNATION_OPTIONS}
                value={designationChoice}
                onValueChange={setDesignationChoice}
                required={false}
              />
              {designationChoice === "__OTHER__" ? (
                <FieldText
                  name="designation"
                  label="Specify designation"
                  defaultValue={initialDesig.other}
                  required
                />
              ) : (
                <input type="hidden" name="designation" value={designationChoice} />
              )}
            </div>
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Position (Teachers) *</p>
            <FieldRadioGroup name="position" options={toOptions(TEACHER_POSITION_LABELS)} defaultValue={defaultValues.position} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">II. Professional Background</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm font-medium mb-2">Highest Educational Attainment *</p>
            <FieldRadioGroup name="educationalAttainment" options={toOptions(EDUCATIONAL_ATTAINMENT_LABELS)} defaultValue={defaultValues.educationalAttainment} />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Field of Specialization *</p>
            <FieldRadioGroup
              name="fieldOfSpecialization"
              options={toOptions(SPECIALIZATION_LABELS)}
              value={specialization}
              onValueChange={setSpecialization}
              defaultValue={defaultValues.fieldOfSpecialization}
            />
            {specialization === "OTHERS" ? (
              <div className="mt-3">
                <FieldText
                  name="specializationOther"
                  label="Specify specialization"
                  defaultValue={defaultValues.specializationOther ?? ""}
                  required
                />
              </div>
            ) : null}
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Years in Service *</p>
            <FieldRadioGroup name="yearsInService" options={toOptions(YEARS_IN_SERVICE_LABELS)} defaultValue={defaultValues.yearsInService} />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Current Grade Level / Assignment</p>
            <FieldRadioGroup name="currentGradeAssignment" options={toOptions(GRADE_LEVEL_LABELS)} defaultValue={defaultValues.currentGradeAssignment ?? undefined} required={false} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">III. Teaching Assignment</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm font-medium mb-2">Most Subject Currently Handled *</p>
          <FieldRadioGroup name="mostSubjectHandled" options={toOptions(SUBJECT_LABELS)} defaultValue={defaultValues.mostSubjectHandled} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">IV. Training & Professional Development</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm font-medium mb-2">Trainings related to literacy/reading? *</p>
            <FieldRadioGroup
              name="hasReadingTraining"
              options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
              value={hasReading}
              onValueChange={setHasReading}
            />
          </div>
          {hasReading === "true" ? (
            <div>
              <p className="text-sm font-medium mb-2">Recent reading trainings (last 5y) *</p>
              <FieldCheckboxList name="readingTrainings" options={toOptions(READING_TRAINING_LABELS)} defaultValues={defaultValues.readingTrainings ?? []} />
              <p className="mt-1 text-xs text-muted-foreground">
                &quot;None at all&quot; cannot be combined with other options.
              </p>
            </div>
          ) : null}
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Trainings related to English Curriculum? *</p>
            <FieldRadioGroup
              name="hasEnglishTraining"
              options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
              value={hasEnglish}
              onValueChange={setHasEnglish}
            />
          </div>
          {hasEnglish === "true" ? (
            <div>
              <p className="text-sm font-medium mb-2">Recent English trainings (last 5y) *</p>
              <FieldCheckboxList name="englishTrainings" options={toOptions(ENGLISH_TRAINING_LABELS)} defaultValues={defaultValues.englishTrainings ?? []} />
              <p className="mt-1 text-xs text-muted-foreground">
                &quot;None at all&quot; cannot be combined with other options.
              </p>
            </div>
          ) : null}
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Highest level of trainings attended *</p>
            <FieldRadioGroup name="highestTrainingLevel" options={toOptions(TRAINING_LEVEL_LABELS)} defaultValue={defaultValues.highestTrainingLevel} />
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save profile"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
