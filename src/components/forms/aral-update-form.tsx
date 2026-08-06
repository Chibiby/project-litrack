"use client";

import { useMemo, useState, useTransition } from "react";
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
  const [transfers, setTransfers] = useState(defaultValues.previousTransfers ?? "");
  const [interventions, setInterventions] = useState<string[]>(
    defaultValues.suggestedInterventions ?? []
  );
  const [further, setFurther] = useState<string[]>(defaultValues.furtherAssessment ?? []);

  const showLsen = interventions.includes("LSEN_OTHER");
  const showFurtherOther = further.includes("OTHER");
  const interventionOptions = useMemo(() => toOptions(INTERVENTION_LABELS), []);
  const furtherOptions = useMemo(() => toOptions(FURTHER_ASSESSMENT_LABELS), []);

  return (
    <form
      action={(fd) => {
        fd.set("learnerId", learnerId);
        if (transfers !== "MULTIPLE") fd.delete("transferDetails");
        if (!showLsen) fd.delete("lsenObservations");
        if (!showFurtherOther) fd.delete("furtherAssessmentOther");
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
      <Card className="violet-section">
        <CardHeader><CardTitle className="text-base">B. Attendance & School Background</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm font-medium mb-2">Mode of Transportation *</p>
            <FieldRadioGroup name="modeOfTransportation" options={toOptions(TRANSPORTATION_LABELS)} defaultValue={defaultValues.modeOfTransportation} />
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Distance from Home to School *</p>
            <FieldRadioGroup name="distanceHomeToSchool" options={toOptions(DISTANCE_LABELS)} defaultValue={defaultValues.distanceHomeToSchool} />
          </div>
          <div>
            <p className="text-sm font-medium mb-2">Previous School Transfers *</p>
            <FieldRadioGroup
              name="previousTransfers"
              options={toOptions(TRANSFER_LABELS)}
              value={transfers}
              onValueChange={setTransfers}
              defaultValue={defaultValues.previousTransfers}
            />
            {transfers === "MULTIPLE" ? (
              <div className="mt-3 space-y-1">
                <Label htmlFor="transferDetails">Specify transfers *</Label>
                <Input
                  id="transferDetails"
                  name="transferDetails"
                  required
                  defaultValue={defaultValues.transferDetails ?? ""}
                />
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="violet-section">
        <CardHeader><CardTitle className="text-base">C. Reading Behavior (Letter-to-Word Level)</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm font-medium mb-2">Frequency of Absenteeism *</p>
            <FieldRadioGroup name="absenteeismFrequency" options={toOptions(ABSENTEEISM_LABELS)} defaultValue={defaultValues.absenteeismFrequency} />
            <div className="mt-3 space-y-1">
              <Label htmlFor="absenteeismOtherReason">Specify reason *</Label>
              <Input
                id="absenteeismOtherReason"
                name="absenteeismOtherReason"
                required
                defaultValue={defaultValues.absenteeismOtherReason ?? ""}
              />
            </div>
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Letter Recognition *</p>
            <FieldRadioGroup name="letterRecognition" options={toOptions(LETTER_RECOGNITION_LABELS)} defaultValue={defaultValues.letterRecognition} />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Letter–Sound Correspondence *</p>
            <FieldRadioGroup name="letterSoundCorrespondence" options={toOptions(LETTER_SOUND_LABELS)} defaultValue={defaultValues.letterSoundCorrespondence} />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Word Recognition *</p>
            <FieldRadioGroup name="wordRecognition" options={toOptions(WORD_RECOGNITION_LABELS)} defaultValue={defaultValues.wordRecognition} />
          </div>
        </CardContent>
      </Card>

      <Card className="violet-section">
        <CardHeader><CardTitle className="text-base">D. External Factors Affecting Reading Progress</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm font-medium mb-2">Home Literacy Environment *</p>
            <FieldRadioGroup name="homeLiteracyEnvironment" options={toOptions(HOME_LITERACY_LABELS)} defaultValue={defaultValues.homeLiteracyEnvironment} />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Parental Support *</p>
            <FieldRadioGroup name="parentalSupport" options={toOptions(PARENTAL_SUPPORT_LABELS)} defaultValue={defaultValues.parentalSupport} />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Classroom Learning Environment *</p>
            <FieldRadioGroup name="classroomEnvironment" options={toOptions(CLASSROOM_ENV_LABELS)} defaultValue={defaultValues.classroomEnvironment} />
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Language Considerations</p>
            <FieldCheckboxList name="languageConsiderations" options={toOptions(LANGUAGE_CONSIDERATION_LABELS)} defaultValues={defaultValues.languageConsiderations ?? []} />
          </div>
        </CardContent>
      </Card>

      <Card className="violet-section">
        <CardHeader><CardTitle className="text-base">E. Suggested Interventions and Recommendations</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-sm font-medium mb-2">Suggested Reading Interventions</p>
            <div className="space-y-2">
              {interventionOptions.map((opt) => (
                <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="suggestedInterventions[]"
                    value={opt.value}
                    checked={interventions.includes(opt.value)}
                    onChange={(e) => {
                      setInterventions((prev) =>
                        e.target.checked
                          ? [...prev, opt.value]
                          : prev.filter((v) => v !== opt.value)
                      );
                    }}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span className="text-sm leading-tight">{opt.label}</span>
                </label>
              ))}
            </div>
            {showLsen ? (
              <div className="mt-3 space-y-1">
                <Label htmlFor="lsenObservations">Specify LSEN observations *</Label>
                <Textarea
                  id="lsenObservations"
                  name="lsenObservations"
                  required
                  defaultValue={defaultValues.lsenObservations ?? ""}
                />
              </div>
            ) : null}
          </div>
          <Separator />
          <div>
            <p className="text-sm font-medium mb-2">Recommendation for Further Assessment</p>
            <div className="space-y-2">
              {furtherOptions.map((opt) => (
                <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    name="furtherAssessment[]"
                    value={opt.value}
                    checked={further.includes(opt.value)}
                    onChange={(e) => {
                      setFurther((prev) =>
                        e.target.checked
                          ? [...prev, opt.value]
                          : prev.filter((v) => v !== opt.value)
                      );
                    }}
                    className="mt-0.5 h-4 w-4 accent-primary"
                  />
                  <span className="text-sm leading-tight">{opt.label}</span>
                </label>
              ))}
            </div>
            {showFurtherOther ? (
              <div className="mt-3 space-y-1">
                <Label htmlFor="furtherAssessmentOther">Specify assessment *</Label>
                <Input
                  id="furtherAssessmentOther"
                  name="furtherAssessmentOther"
                  required
                  defaultValue={defaultValues.furtherAssessmentOther ?? ""}
                />
              </div>
            ) : null}
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
