"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { FieldText, FieldRadioGroup, FieldCheckboxList } from "./profile-shared";
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

type Defaults = Partial<{
  contactNumber: string | null;
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

export function TeacherProfileForm({ defaultValues }: { defaultValues: Defaults }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) =>
        startTransition(async () => {
          const res = await saveTeacherProfile(fd);
          if (res.ok) {
            toast.success("Profile saved");
            router.push("/teacher");
          } else toast.error(res.error);
        })
      }
      className="space-y-6"
    >
      <Card>
        <CardHeader><CardTitle className="text-base">I. Respondent Information</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FieldText name="contactNumber" label="Contact number" defaultValue={defaultValues.contactNumber ?? ""} />
            <FieldText name="designation" label="Designation" defaultValue={defaultValues.designation ?? ""} />
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Position *</p>
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
            <FieldRadioGroup name="fieldOfSpecialization" options={toOptions(SPECIALIZATION_LABELS)} defaultValue={defaultValues.fieldOfSpecialization} />
            <div className="mt-3">
              <FieldText name="specializationOther" label="If 'Others', specify" defaultValue={defaultValues.specializationOther ?? ""} />
            </div>
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
              defaultValue={defaultValues.hasReadingTraining ? "true" : "false"}
            />
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Recent reading trainings (last 5y)</p>
            <FieldCheckboxList name="readingTrainings" options={toOptions(READING_TRAINING_LABELS)} defaultValues={defaultValues.readingTrainings ?? []} />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Trainings related to English Curriculum? *</p>
            <FieldRadioGroup
              name="hasEnglishTraining"
              options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
              defaultValue={defaultValues.hasEnglishTraining ? "true" : "false"}
            />
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Recent English trainings (last 5y)</p>
            <FieldCheckboxList name="englishTrainings" options={toOptions(ENGLISH_TRAINING_LABELS)} defaultValues={defaultValues.englishTrainings ?? []} />
          </div>
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
