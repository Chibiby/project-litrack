"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { FieldRadioGroup, FieldCheckboxList } from "./profile-shared";
import {
  TRANSPORTATION_LABELS,
  DISTANCE_LABELS,
  TRANSFER_LABELS,
  ABSENTEEISM_LABELS,
  LETTER_RECOGNITION_LABELS,
  LETTER_SOUND_LABELS,
  WORD_RECOGNITION_LABELS,
  HOME_LITERACY_LABELS,
  PARENTAL_SUPPORT_LABELS,
  CLASSROOM_ENV_LABELS,
  LANGUAGE_CONSIDERATION_LABELS,
  INTERVENTION_LABELS,
  FURTHER_ASSESSMENT_LABELS,
  toOptions,
} from "@/lib/constants/enum-labels";
import { saveAralProfile } from "@/lib/actions/aral";

type Defaults = Partial<{
  modeOfTransportation: string;
  distanceHomeToSchool: string;
  previousTransfers: string;
  transferDetails: string | null;
  absenteeismFrequency: string;
  absenteeismOtherReason: string | null;
  letterRecognition: string;
  letterSoundCorrespondence: string;
  wordRecognition: string;
  homeLiteracyEnvironment: string;
  parentalSupport: string;
  classroomEnvironment: string;
  languageConsiderations: string[];
  suggestedInterventions: string[];
  lsenObservations: string | null;
  furtherAssessment: string[];
  furtherAssessmentOther: string | null;
}>;

export function AralUpdateForm({ learnerId, defaultValues = {} }: { learnerId: string; defaultValues?: Defaults }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => {
        fd.set("learnerId", learnerId);
        startTransition(async () => {
          const res = await saveAralProfile(fd);
          if (res.ok) {
            toast.success("ARAL profile saved");
            router.back();
          } else toast.error(res.error);
        });
      }}
      className="space-y-6"
    >
      <Card className="brand-section">
        <CardHeader><CardTitle className="text-base">B. Attendance & School Background</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p id="group-label-aralupdateformtsx-1" className="mb-2 text-sm font-medium">Mode of Transportation *</p>
            <FieldRadioGroup aria-labelledby="group-label-aralupdateformtsx-1" name="modeOfTransportation" options={toOptions(TRANSPORTATION_LABELS)} defaultValue={defaultValues.modeOfTransportation} />
          </div>
          <div>
            <p id="group-label-aralupdateformtsx-2" className="mb-2 text-sm font-medium">Distance from Home to School *</p>
            <FieldRadioGroup aria-labelledby="group-label-aralupdateformtsx-2" name="distanceHomeToSchool" options={toOptions(DISTANCE_LABELS)} defaultValue={defaultValues.distanceHomeToSchool} />
          </div>
          <div>
            <p id="group-label-aralupdateformtsx-3" className="mb-2 text-sm font-medium">Previous School Transfers *</p>
            <FieldRadioGroup aria-labelledby="group-label-aralupdateformtsx-3" name="previousTransfers" options={toOptions(TRANSFER_LABELS)} defaultValue={defaultValues.previousTransfers} />
            <div className="mt-3 space-y-1">
              <Label htmlFor="transferDetails">If Multiple, specify</Label>
              <Input id="transferDetails" name="transferDetails" defaultValue={defaultValues.transferDetails ?? ""} />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="brand-section">
        <CardHeader><CardTitle className="text-base">C. Reading Behavior (Letter-to-Word Level)</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p id="group-label-aralupdateformtsx-4" className="mb-2 text-sm font-medium">Frequency of Absenteeism *</p>
            <FieldRadioGroup aria-labelledby="group-label-aralupdateformtsx-4" name="absenteeismFrequency" options={toOptions(ABSENTEEISM_LABELS)} defaultValue={defaultValues.absenteeismFrequency} />
            <div className="mt-3 space-y-1">
              <Label htmlFor="absenteeismOtherReason">If &apos;Other&apos;, specify reason</Label>
              <Input id="absenteeismOtherReason" name="absenteeismOtherReason" defaultValue={defaultValues.absenteeismOtherReason ?? ""} />
            </div>
          </div>
          <Separator />
          <div>
            <p id="group-label-aralupdateformtsx-5" className="mb-2 text-sm font-medium">Letter Recognition *</p>
            <FieldRadioGroup aria-labelledby="group-label-aralupdateformtsx-5" name="letterRecognition" options={toOptions(LETTER_RECOGNITION_LABELS)} defaultValue={defaultValues.letterRecognition} />
          </div>
          <Separator />
          <div>
            <p id="group-label-aralupdateformtsx-6" className="mb-2 text-sm font-medium">Letter–Sound Correspondence *</p>
            <FieldRadioGroup aria-labelledby="group-label-aralupdateformtsx-6" name="letterSoundCorrespondence" options={toOptions(LETTER_SOUND_LABELS)} defaultValue={defaultValues.letterSoundCorrespondence} />
          </div>
          <Separator />
          <div>
            <p id="group-label-aralupdateformtsx-7" className="mb-2 text-sm font-medium">Word Recognition *</p>
            <FieldRadioGroup aria-labelledby="group-label-aralupdateformtsx-7" name="wordRecognition" options={toOptions(WORD_RECOGNITION_LABELS)} defaultValue={defaultValues.wordRecognition} />
          </div>
        </CardContent>
      </Card>

      <Card className="brand-section">
        <CardHeader><CardTitle className="text-base">D. External Factors Affecting Reading Progress</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p id="group-label-aralupdateformtsx-8" className="mb-2 text-sm font-medium">Home Literacy Environment *</p>
            <FieldRadioGroup aria-labelledby="group-label-aralupdateformtsx-8" name="homeLiteracyEnvironment" options={toOptions(HOME_LITERACY_LABELS)} defaultValue={defaultValues.homeLiteracyEnvironment} />
          </div>
          <Separator />
          <div>
            <p id="group-label-aralupdateformtsx-9" className="mb-2 text-sm font-medium">Parental Support *</p>
            <FieldRadioGroup aria-labelledby="group-label-aralupdateformtsx-9" name="parentalSupport" options={toOptions(PARENTAL_SUPPORT_LABELS)} defaultValue={defaultValues.parentalSupport} />
          </div>
          <Separator />
          <div>
            <p id="group-label-aralupdateformtsx-10" className="mb-2 text-sm font-medium">Classroom Learning Environment *</p>
            <FieldRadioGroup aria-labelledby="group-label-aralupdateformtsx-10" name="classroomEnvironment" options={toOptions(CLASSROOM_ENV_LABELS)} defaultValue={defaultValues.classroomEnvironment} />
          </div>
          <Separator />
          <div>
            <p id="group-label-aralupdateformtsx-11" className="mb-2 text-sm font-medium">Language Considerations</p>
            <FieldCheckboxList aria-labelledby="group-label-aralupdateformtsx-11" name="languageConsiderations" options={toOptions(LANGUAGE_CONSIDERATION_LABELS)} defaultValues={defaultValues.languageConsiderations ?? []} />
          </div>
        </CardContent>
      </Card>

      <Card className="brand-section">
        <CardHeader><CardTitle className="text-base">E. Suggested Interventions and Recommendations</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p id="group-label-aralupdateformtsx-12" className="mb-2 text-sm font-medium">Suggested Reading Interventions</p>
            <FieldCheckboxList aria-labelledby="group-label-aralupdateformtsx-12" name="suggestedInterventions" options={toOptions(INTERVENTION_LABELS)} defaultValues={defaultValues.suggestedInterventions ?? []} />
            <div className="mt-3 space-y-1">
              <Label htmlFor="lsenObservations">If LSEN intervention chosen, observations</Label>
              <Textarea id="lsenObservations" name="lsenObservations" defaultValue={defaultValues.lsenObservations ?? ""} />
            </div>
          </div>
          <Separator />
          <div>
            <p id="group-label-aralupdateformtsx-13" className="mb-2 text-sm font-medium">Recommendation for Further Assessment</p>
            <FieldCheckboxList aria-labelledby="group-label-aralupdateformtsx-13" name="furtherAssessment" options={toOptions(FURTHER_ASSESSMENT_LABELS)} defaultValues={defaultValues.furtherAssessment ?? []} />
            <div className="mt-3 space-y-1">
              <Label htmlFor="furtherAssessmentOther">If &apos;Other&apos;, specify</Label>
              <Input id="furtherAssessmentOther" name="furtherAssessmentOther" defaultValue={defaultValues.furtherAssessmentOther ?? ""} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save ARAL profile"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
