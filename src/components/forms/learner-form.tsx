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
      className="space-y-4 max-h-[700px] overflow-y-auto pr-2"
    >
      <div className="grid gap-3 grid-cols-3">
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
      <div className="grid gap-3 grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="age">Age *</Label>
          <Input id="age" name="age" type="number" min={3} max={25} required />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Gender *</p>
          <FieldRadioGroup name="gender" options={[{ value: "MALE", label: "Male" }, { value: "FEMALE", label: "Female" }]} />
        </div>
      </div>

      <Separator />
      <div>
        <p className="text-sm font-medium mb-2">Reading Level (English) *</p>
        <FieldRadioGroup name="englishReadingProfile" options={toOptions(READING_PROFILE_LABELS)} />
        <p className="text-xs text-muted-foreground mt-2 mb-1">If frustration:</p>
        <FieldCheckboxList name="englishFrustrationSubtypes" options={toOptions(FRUSTRATION_SUBTYPE_LABELS)} />
      </div>

      <Separator />
      <div>
        <p className="text-sm font-medium mb-2">Reading Level (Filipino) *</p>
        <FieldRadioGroup name="filipinoReadingProfile" options={toOptions(READING_PROFILE_LABELS)} />
        <p className="text-xs text-muted-foreground mt-2 mb-1">If frustration:</p>
        <FieldCheckboxList name="filipinoFrustrationSubtypes" options={toOptions(FRUSTRATION_SUBTYPE_LABELS)} />
      </div>

      <Separator />
      <div>
        <p className="text-sm font-medium mb-2">Government Benefits Received</p>
        <FieldCheckboxList name="governmentBenefits" options={toOptions(GOV_BENEFIT_LABELS)} />
      </div>

      <Separator />
      <div>
        <p className="text-sm font-medium mb-2">Parents&apos; Educational Background *</p>
        <FieldRadioGroup name="parentEducation" options={toOptions(PARENT_EDUCATION_LABELS)} />
      </div>

      <Separator />
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" name="isAralLearner" className="h-4 w-4 accent-primary" />
        <span className="text-sm">Identify as ARAL learner now</span>
      </label>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Saving…" : "Add learner"}
      </Button>
    </form>
  );
}
