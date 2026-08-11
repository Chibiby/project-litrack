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
  FRUSTRATION_SUBTYPE_LABELS,
  GRADE_LEVEL_LABELS,
  PARENT_EDUCATION_LABELS,
  TRANSPORTATION_LABELS,
  DISTANCE_LABELS,
  TRANSFER_LABELS,
  isEarlyGradeReadingBand,
  readingProfileLabelsForGradeType,
  toOptions,
} from "@/lib/constants/enum-labels";
import { createLearner, updateLearner } from "@/lib/actions/learner";
import { invalidateNavWarm } from "@/components/nav-prefetcher";

export type LearnerFormSectionOption = {
  id: string;
  name: string;
  gradeLevelId: string;
};

export type LearnerFormGradeOption = {
  id: string;
  type: string;
  label: string;
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
  modeOfTransportation?: string | null;
  distanceHomeToSchool?: string | null;
  previousTransfers?: string | null;
  transferDetails?: string | null;
  sectionId?: string | null;
};

type LearnerFormProps = {
  gradeLevelId: string;
  /** Teacher-assigned grades for create-mode grade select. */
  grades?: LearnerFormGradeOption[];
  /** Grade type for edit/read-only band labels when grades[] is not provided. */
  gradeType?: string;
  mode?: "create" | "edit";
  defaultValues?: LearnerFormDefaults;
  submitLabel?: string;
  /** After successful edit, navigate here (defaults to learner detail). */
  redirectTo?: string;
  /** Active sections for the teacher's grades; filtered by selected grade. */
  sections?: LearnerFormSectionOption[];
  /** Fired on successful create (e.g. close Add Learner sheet before refresh). */
  onCreated?: () => void;
};

const FRUSTRATION = "FRUSTRATION_HIGH_EMERGENT";

export function LearnerForm({
  gradeLevelId,
  grades = [],
  gradeType,
  mode = "create",
  defaultValues,
  submitLabel,
  redirectTo,
  sections = [],
  onCreated,
}: LearnerFormProps) {
  const [pending, startTransition] = useTransition();
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [selectedGradeLevelId, setSelectedGradeLevelId] = useState(gradeLevelId);
  const [englishProfile, setEnglishProfile] = useState(defaultValues?.englishReadingProfile ?? "");
  const [filipinoProfile, setFilipinoProfile] = useState(
    defaultValues?.filipinoReadingProfile ?? ""
  );
  const [previousTransfers, setPreviousTransfers] = useState(
    defaultValues?.previousTransfers ?? ""
  );
  const [sectionId, setSectionId] = useState(defaultValues?.sectionId ?? "");
  const router = useRouter();
  const isEdit = mode === "edit";
  const label = submitLabel ?? (isEdit ? "Save changes" : "Add learner");

  const selectedGradeType = useMemo(() => {
    const fromGrades = grades.find((g) => g.id === selectedGradeLevelId)?.type;
    return fromGrades ?? gradeType;
  }, [grades, selectedGradeLevelId, gradeType]);

  const readingProfileOptions = useMemo(
    () => toOptions(readingProfileLabelsForGradeType(selectedGradeType)),
    [selectedGradeType]
  );

  const frustrationHint = selectedGradeType && isEarlyGradeReadingBand(selectedGradeType)
    ? "If high emergent:"
    : "If frustration:";

  const selectedGradeLabel = useMemo(() => {
    const fromGrades = grades.find((g) => g.id === selectedGradeLevelId)?.label;
    if (fromGrades) return fromGrades;
    if (selectedGradeType) {
      return GRADE_LEVEL_LABELS[selectedGradeType] ?? selectedGradeType;
    }
    return "—";
  }, [grades, selectedGradeLevelId, selectedGradeType]);

  const gradeSections = useMemo(
    () => sections.filter((s) => s.gradeLevelId === selectedGradeLevelId),
    [sections, selectedGradeLevelId]
  );

  useEffect(() => {
    if (sectionId && !gradeSections.some((s) => s.id === sectionId)) {
      setSectionId("");
    }
  }, [selectedGradeLevelId, gradeSections, sectionId]);

  function handleSubmit(fd: FormData) {
    fd.set("gradeLevelId", selectedGradeLevelId);
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
    if (previousTransfers !== "MULTIPLE") {
      fd.delete("transferDetails");
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

      const toastId = toast.loading("Adding learner…");
      const res = await createLearner(fd);
      if (res.ok) {
        // Close sheet / clear form immediately; list refreshes in background.
        onCreated?.();
        toast.success("Learner added", { id: toastId });
        setDuplicatePending(false);
        (document.getElementById("learner-form") as HTMLFormElement | null)?.reset();
        setSelectedGradeLevelId(gradeLevelId);
        setEnglishProfile("");
        setFilipinoProfile("");
        setPreviousTransfers("");
        setSectionId("");
        router.refresh();
        invalidateNavWarm();
      } else if (res.error === "possible_duplicate") {
        setDuplicatePending(true);
        toast.warning(
          "A learner with the same name and age already exists in this school",
          { id: toastId }
        );
      } else {
        toast.error(res.error, { id: toastId });
      }
    });
  }

  return (
    <form
      action={handleSubmit}
      id="learner-form"
      className="space-y-4 max-h-[700px] overflow-y-auto pr-2"
    >
      <div className="space-y-1">
        <Label htmlFor="gradeLevelId">Grade *</Label>
        {isEdit ? (
          <>
            <input type="hidden" name="gradeLevelId" value={selectedGradeLevelId} />
            <select
              id="gradeLevelId"
              disabled
              value={selectedGradeLevelId}
              className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm disabled:opacity-50"
            >
              <option value={selectedGradeLevelId}>{selectedGradeLabel}</option>
            </select>
          </>
        ) : (
          <select
            id="gradeLevelId"
            name="gradeLevelId"
            required
            value={selectedGradeLevelId}
            onChange={(e) => setSelectedGradeLevelId(e.target.value)}
            className="flex h-10 w-full rounded-lg border border-input bg-card px-3 text-sm"
          >
            {grades.length === 0 ? (
              <option value={gradeLevelId}>Select grade</option>
            ) : null}
            {grades.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        )}
      </div>

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
          disabled={!selectedGradeLevelId}
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
          options={readingProfileOptions}
          value={englishProfile}
          onValueChange={setEnglishProfile}
          defaultValue={defaultValues?.englishReadingProfile}
        />
        {englishProfile === FRUSTRATION ? (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground mb-1">{frustrationHint}</p>
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
          options={readingProfileOptions}
          value={filipinoProfile}
          onValueChange={setFilipinoProfile}
          defaultValue={defaultValues?.filipinoReadingProfile}
        />
        {filipinoProfile === FRUSTRATION ? (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground mb-1">{frustrationHint}</p>
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
        <p className="text-sm font-medium mb-2">Is the student a 4Ps beneficiary?</p>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            name="governmentBenefits[]"
            value="FOUR_PS"
            defaultChecked={defaultValues?.governmentBenefits?.includes("FOUR_PS")}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="text-sm leading-tight">Yes</span>
        </label>
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

      <Separator />
      <div className="space-y-4">
        <p className="text-sm font-medium">B. Attendance &amp; School Background</p>
        <div>
          <p className="text-sm font-medium mb-2">Mode of Transportation</p>
          <FieldRadioGroup
            name="modeOfTransportation"
            options={toOptions(TRANSPORTATION_LABELS)}
            defaultValue={defaultValues?.modeOfTransportation ?? undefined}
            required={false}
          />
        </div>
        <div>
          <p className="text-sm font-medium mb-2">Distance from Home to School</p>
          <FieldRadioGroup
            name="distanceHomeToSchool"
            options={toOptions(DISTANCE_LABELS)}
            defaultValue={defaultValues?.distanceHomeToSchool ?? undefined}
            required={false}
          />
        </div>
        <div>
          <p className="text-sm font-medium mb-2">Previous School Transfers</p>
          <FieldRadioGroup
            name="previousTransfers"
            options={toOptions(TRANSFER_LABELS)}
            value={previousTransfers}
            onValueChange={setPreviousTransfers}
            defaultValue={defaultValues?.previousTransfers ?? undefined}
            required={false}
          />
          {previousTransfers === "MULTIPLE" ? (
            <div className="mt-3 space-y-1">
              <Label htmlFor="transferDetails">Specify transfers *</Label>
              <Input
                id="transferDetails"
                name="transferDetails"
                required
                defaultValue={defaultValues?.transferDetails ?? ""}
              />
            </div>
          ) : null}
        </div>
      </div>

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
