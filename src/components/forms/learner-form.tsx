"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { createLearner, updateLearner } from "@/lib/actions/learner";
import { invalidateNavWarm } from "@/components/nav-prefetcher";

export type LearnerFormSectionOption = {
  id: string;
  name: string;
  gradeLevelId: string;
};

export type LearnerFormDefaults = {
  id?: string;
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  age?: number;
  gender?: string;
  englishReadingProfile?: string;
  englishFrustrationSubtypes?: string[];
  filipinoReadingProfile?: string;
  filipinoFrustrationSubtypes?: string[];
  governmentBenefits?: string[];
  parentEducation?: string;
  isAralLearner?: boolean;
  sectionId?: string | null;
};

type LearnerFormProps = {
  gradeLevelId: string;
  mode?: "create" | "edit";
  defaultValues?: LearnerFormDefaults;
  submitLabel?: string;
  /** After successful edit, navigate here (defaults to learner detail). */
  redirectTo?: string;
  /** Active sections for the teacher's grades; filtered by gradeLevelId. */
  sections?: LearnerFormSectionOption[];
};

const FRUSTRATION = "FRUSTRATION_HIGH_EMERGENT";

export function LearnerForm({
  gradeLevelId,
  mode = "create",
  defaultValues,
  submitLabel,
  redirectTo,
  sections = [],
}: LearnerFormProps) {
  const [pending, startTransition] = useTransition();
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [englishProfile, setEnglishProfile] = useState(defaultValues?.englishReadingProfile ?? "");
  const [filipinoProfile, setFilipinoProfile] = useState(
    defaultValues?.filipinoReadingProfile ?? ""
  );
  const [sectionId, setSectionId] = useState(defaultValues?.sectionId ?? "");
  const router = useRouter();
  const isEdit = mode === "edit";
  const label = submitLabel ?? (isEdit ? "Save changes" : "Add learner");

  const gradeSections = useMemo(
    () => sections.filter((s) => s.gradeLevelId === gradeLevelId),
    [sections, gradeLevelId]
  );

  useEffect(() => {
    if (sectionId && !gradeSections.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [gradeLevelId, gradeSections, sectionId]);

  function handleSubmit(fd: FormData) {
    fd.set("gradeLevelId", gradeLevelId);
    if (isEdit && defaultValues?.id) {
      fd.set("id", defaultValues.id);
    }
    if (duplicatePending) {
      fd.set("confirmDuplicate", "true");
    }
    // Strip frustration subtypes when not Frustration (client + server refine)
    if (englishProfile !== FRUSTRATION) {
      fd.delete("englishFrustrationSubtypes[]");
    }
    if (filipinoProfile !== FRUSTRATION) {
      fd.delete("filipinoFrustrationSubtypes[]");
    }

    startTransition(async () => {
      if (isEdit) {
        const res = await updateLearner(fd);
        if (res.ok) {
          toast.success("Learner updated");
          const dest =
            redirectTo ??
            `/teacher/grade/${gradeLevelId}/learners/${defaultValues?.id}`;
          router.push(dest);
          router.refresh();
          invalidateNavWarm();
        } else {
          toast.error(res.error);
        }
        return;
      }

      const res = await createLearner(fd);
      if (res.ok) {
        toast.success("Learner added");
        setDuplicatePending(false);
        (document.getElementById("learner-form") as HTMLFormElement | null)?.reset();
        setEnglishProfile("");
        setFilipinoProfile("");
        setSectionId("");
        router.refresh();
        invalidateNavWarm();
      } else if (res.error === "possible_duplicate") {
        setDuplicatePending(true);
        toast.warning(
          "A learner with the same name and age already exists in this school"
        );
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <form
      action={handleSubmit}
      id="learner-form"
      className="space-y-4 max-h-[700px] overflow-y-auto pr-2"
    >
      <div className="grid gap-3 grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor="firstName">First name *</Label>
          <Input
            id="firstName"
            name="firstName"
            required
            defaultValue={defaultValues?.firstName ?? ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="middleName">Middle name</Label>
          <Input
            id="middleName"
            name="middleName"
            defaultValue={defaultValues?.middleName ?? ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="lastName">Last name *</Label>
          <Input
            id="lastName"
            name="lastName"
            required
            defaultValue={defaultValues?.lastName ?? ""}
          />
        </div>
      </div>
      <div className="grid gap-3 grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="age">Age *</Label>
          <Input
            id="age"
            name="age"
            type="number"
            min={3}
            max={25}
            required
            defaultValue={defaultValues?.age ?? ""}
          />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium">Gender *</p>
          <FieldRadioGroup
            name="gender"
            options={[
              { value: "MALE", label: "Male" },
              { value: "FEMALE", label: "Female" },
            ]}
            defaultValue={defaultValues?.gender}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="sectionId">Section (optional)</Label>
        <select
          id="sectionId"
          name="sectionId"
          value={sectionId}
          onChange={(e) => setSectionId(e.target.value)}
          disabled={!gradeLevelId}
          className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm disabled:opacity-50"
        >
          <option value="">No section (optional)</option>
          {gradeSections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <Separator />
      <div>
        <p className="text-sm font-medium mb-2">Reading Level (English) *</p>
        <FieldRadioGroup
          name="englishReadingProfile"
          options={toOptions(READING_PROFILE_LABELS)}
          value={englishProfile}
          onValueChange={setEnglishProfile}
          defaultValue={defaultValues?.englishReadingProfile}
        />
        {englishProfile === FRUSTRATION ? (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground mb-1">If frustration:</p>
            <FieldCheckboxList
              name="englishFrustrationSubtypes"
              options={toOptions(FRUSTRATION_SUBTYPE_LABELS)}
              defaultValues={defaultValues?.englishFrustrationSubtypes ?? []}
            />
          </div>
        ) : null}
      </div>

      <Separator />
      <div>
        <p className="text-sm font-medium mb-2">Reading Level (Filipino) *</p>
        <FieldRadioGroup
          name="filipinoReadingProfile"
          options={toOptions(READING_PROFILE_LABELS)}
          value={filipinoProfile}
          onValueChange={setFilipinoProfile}
          defaultValue={defaultValues?.filipinoReadingProfile}
        />
        {filipinoProfile === FRUSTRATION ? (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground mb-1">If frustration:</p>
            <FieldCheckboxList
              name="filipinoFrustrationSubtypes"
              options={toOptions(FRUSTRATION_SUBTYPE_LABELS)}
              defaultValues={defaultValues?.filipinoFrustrationSubtypes ?? []}
            />
          </div>
        ) : null}
      </div>

      <Separator />
      <div>
        <p className="text-sm font-medium mb-2">Government Benefits Received</p>
        <FieldCheckboxList
          name="governmentBenefits"
          options={toOptions(GOV_BENEFIT_LABELS)}
          defaultValues={defaultValues?.governmentBenefits ?? []}
        />
      </div>

      <Separator />
      <div>
        <p className="text-sm font-medium mb-2">Parents&apos; Educational Background *</p>
        <FieldRadioGroup
          name="parentEducation"
          options={toOptions(PARENT_EDUCATION_LABELS)}
          defaultValue={defaultValues?.parentEducation}
        />
      </div>

      {!isEdit && (
        <>
          <Separator />
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              name="isAralLearner"
              className="h-4 w-4 accent-primary"
              defaultChecked={defaultValues?.isAralLearner}
            />
            <span className="text-sm">Identify as ARAL learner now</span>
          </label>
        </>
      )}

      {duplicatePending && !isEdit && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950"
        >
          <p className="font-medium">
            A learner with the same name and age already exists in this school.
          </p>
          <p className="mt-1 text-amber-900/80">
            Review the list before continuing. Click &quot;Create anyway&quot; to
            confirm this is a different learner.
          </p>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={pending}>
        {pending
          ? "Saving…"
          : duplicatePending && !isEdit
            ? "Create anyway"
            : label}
      </Button>
    </form>
  );
}
