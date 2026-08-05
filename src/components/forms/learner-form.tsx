"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { FieldRadioGroup, FieldCheckboxList } from "./profile-shared";
import {
  READING_PROFILE_LABELS,
  FRUSTRATION_SUBTYPE_LABELS,
  GOV_BENEFIT_LABELS,
  PARENT_EDUCATION_LABELS,
  toOptions,
} from "@/lib/constants/enum-labels";
import { createLearner } from "@/lib/actions/learner";

export function LearnerForm({ gradeLevelId }: { gradeLevelId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => {
        fd.set("gradeLevelId", gradeLevelId);
        startTransition(async () => {
          const res = await createLearner(fd);
          if (res.ok) {
            toast.success("Learner added");
            (document.getElementById("learner-form") as HTMLFormElement)?.reset();
          } else toast.error(res.error);
        });
      }}
      id="learner-form"
      className="max-h-[700px] space-y-4 overflow-y-auto pr-2"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="firstName">First name *</Label>
          <Input id="firstName" name="firstName" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="middleName">Middle name</Label>
          <Input id="middleName" name="middleName" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lastName">Last name *</Label>
          <Input id="lastName" name="lastName" required />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="age">Age *</Label>
          <Input id="age" name="age" type="number" min={3} max={25} required />
        </div>
        <fieldset className="space-y-1">
          <legend id="learner-gender-legend" className="text-sm font-medium">Gender *</legend>
          <FieldRadioGroup
            aria-labelledby="learner-gender-legend"
            name="gender"
            options={[
              { value: "MALE", label: "Male" },
              { value: "FEMALE", label: "Female" },
            ]}
          />
        </fieldset>
      </div>

      <Separator />
      <fieldset>
        <legend id="learner-english-reading-legend" className="mb-2 text-sm font-medium">Reading Level (English) *</legend>
        <FieldRadioGroup aria-labelledby="learner-english-reading-legend" name="englishReadingProfile" options={toOptions(READING_PROFILE_LABELS)} />
        <p className="mb-1 mt-2 text-xs text-muted-foreground">If frustration:</p>
        <FieldCheckboxList
          name="englishFrustrationSubtypes"
          options={toOptions(FRUSTRATION_SUBTYPE_LABELS)}
        />
      </fieldset>

      <Separator />
      <fieldset>
        <legend id="learner-filipino-reading-legend" className="mb-2 text-sm font-medium">Reading Level (Filipino) *</legend>
        <FieldRadioGroup aria-labelledby="learner-filipino-reading-legend" name="filipinoReadingProfile" options={toOptions(READING_PROFILE_LABELS)} />
        <p className="mb-1 mt-2 text-xs text-muted-foreground">If frustration:</p>
        <FieldCheckboxList
          name="filipinoFrustrationSubtypes"
          options={toOptions(FRUSTRATION_SUBTYPE_LABELS)}
        />
      </fieldset>

      <Separator />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Government Benefits Received</legend>
        <FieldCheckboxList name="governmentBenefits" options={toOptions(GOV_BENEFIT_LABELS)} />
      </fieldset>

      <Separator />
      <fieldset>
        <legend id="learner-parent-education-legend" className="mb-2 text-sm font-medium">Parents&apos; Educational Background *</legend>
        <FieldRadioGroup aria-labelledby="learner-parent-education-legend" name="parentEducation" options={toOptions(PARENT_EDUCATION_LABELS)} />
      </fieldset>

      <Separator />
      <label className="flex cursor-pointer items-center gap-2">
        <input type="checkbox" name="isAralLearner" className="h-4 w-4 accent-primary" />
        <span className="text-sm">Identify as ARAL learner now</span>
      </label>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Add learner"}
      </Button>
    </form>
  );
}
