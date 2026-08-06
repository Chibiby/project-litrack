"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FieldText, FieldRadioGroup, FieldCheckboxList, FieldReadOnlyEmail } from "./profile-shared";
import {
  SCHOOL_HEAD_POSITION_LABELS,
  EDUCATIONAL_ATTAINMENT_LABELS,
  SPECIALIZATION_LABELS,
  YEARS_IN_SERVICE_LABELS,
  TRAINING_LEVEL_LABELS,
  READING_TRAINING_LABELS,
  ENGLISH_TRAINING_LABELS,
  toOptions,
} from "@/lib/constants/enum-labels";
import { saveSchoolHeadProfile } from "@/lib/actions/school-head";

const DESIGNATION_OPTIONS = [
  { value: "Teacher", label: "Teacher" },
  { value: "Master Teacher", label: "Master Teacher" },
  { value: "School Head", label: "School Head" },
  { value: "__OTHER__", label: "Others" },
];

type Defaults = {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  accountEmail?: string;
  accountEmailIsSynthetic?: boolean;
  contactNumber?: string | null;
  contactEmail?: string | null;
  designation?: string | null;
  position?: string;
  educationalAttainment?: string;
  fieldOfSpecialization?: string;
  specializationOther?: string | null;
  yearsInService?: string;
  hasReadingTraining?: boolean;
  readingTrainings?: string[];
  hasEnglishTraining?: boolean;
  englishTrainings?: string[];
  highestTrainingLevel?: string;
};

function resolveDesignationChoice(raw?: string | null): { choice: string; other: string } {
  if (!raw) return { choice: "School Head", other: "" };
  const known = DESIGNATION_OPTIONS.find((o) => o.value === raw && o.value !== "__OTHER__");
  if (known) return { choice: known.value, other: "" };
  return { choice: "__OTHER__", other: raw };
}

export function SchoolHeadProfileForm({ defaultValues }: { defaultValues: Defaults }) {
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
        if (designationChoice !== "__OTHER__" && designationChoice) {
          fd.set("designation", designationChoice);
        }
        if (specialization !== "OTHERS") fd.delete("specializationOther");
        if (hasReading !== "true") fd.delete("readingTrainings[]");
        if (hasEnglish !== "true") fd.delete("englishTrainings[]");
        startTransition(async () => {
          try {
            await saveSchoolHeadProfile(fd);
            toast.success("Profile saved");
            router.push("/school-head");
          } catch (e) {
            const message = e instanceof Error ? e.message : "Failed to save profile";
            toast.error(message);
          }
        });
      }}
      className="space-y-6"
    >
      <Card>
        <CardHeader><CardTitle className="text-base">I. Respondent Information</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            <FieldText name="firstName" label="First name" defaultValue={defaultValues.firstName} required />
            <FieldText name="middleName" label="Middle name" defaultValue={defaultValues.middleName ?? ""} />
            <FieldText name="lastName" label="Last name" defaultValue={defaultValues.lastName} required />
          </div>
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
          <div className="space-y-2">
            <p className="text-sm font-medium">Position (School Head) *</p>
            <FieldRadioGroup
              name="position"
              options={toOptions(SCHOOL_HEAD_POSITION_LABELS)}
              defaultValue={defaultValues.position}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">II. Professional Background</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm font-medium mb-2">Highest Educational Attainment *</p>
            <FieldRadioGroup
              name="educationalAttainment"
              options={toOptions(EDUCATIONAL_ATTAINMENT_LABELS)}
              defaultValue={defaultValues.educationalAttainment}
            />
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
            <FieldRadioGroup
              name="yearsInService"
              options={toOptions(YEARS_IN_SERVICE_LABELS)}
              defaultValue={defaultValues.yearsInService}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">IV. Training & Professional Development</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm font-medium mb-2">Have you attended trainings related to literacy/reading instruction? *</p>
            <FieldRadioGroup
              name="hasReadingTraining"
              options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
              value={hasReading}
              onValueChange={setHasReading}
            />
          </div>
          {hasReading === "true" ? (
            <div>
              <p className="text-sm font-medium mb-2">Recent reading trainings (last 5 years) *</p>
              <FieldCheckboxList
                name="readingTrainings"
                options={toOptions(READING_TRAINING_LABELS)}
                defaultValues={defaultValues.readingTrainings ?? []}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                &quot;None at all&quot; cannot be combined with other options.
              </p>
            </div>
          ) : null}
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Have you attended trainings related to English Curriculum Instruction? *</p>
            <FieldRadioGroup
              name="hasEnglishTraining"
              options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
              value={hasEnglish}
              onValueChange={setHasEnglish}
            />
          </div>
          {hasEnglish === "true" ? (
            <div>
              <p className="text-sm font-medium mb-2">Recent English curriculum trainings (last 5 years) *</p>
              <FieldCheckboxList
                name="englishTrainings"
                options={toOptions(ENGLISH_TRAINING_LABELS)}
                defaultValues={defaultValues.englishTrainings ?? []}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                &quot;None at all&quot; cannot be combined with other options.
              </p>
            </div>
          ) : null}
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Highest level of trainings attended *</p>
            <FieldRadioGroup
              name="highestTrainingLevel"
              options={toOptions(TRAINING_LEVEL_LABELS)}
              defaultValue={defaultValues.highestTrainingLevel}
            />
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
