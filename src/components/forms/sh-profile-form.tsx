"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppForm, useAppForm, markFormClean } from "@/components/forms/app-form";
import { ProfileWizardChrome, type WizardStepDef } from "@/components/forms/profiling/wizard-chrome";
import {
  FormCheckboxChips,
  FormSelectField,
  FormTextField,
  FormYesNoPills,
  ReadOnlyField,
} from "@/components/forms/profiling/wizard-fields";
import {
  SCHOOL_HEAD_POSITION_LABELS,
  EDUCATIONAL_ATTAINMENT_LABELS,
  SPECIALIZATION_LABELS,
  TRAINING_LEVEL_LABELS,
  READING_TRAINING_LABELS,
  ENGLISH_TRAINING_LABELS,
  GRADE_LEVEL_LABELS,
  toOptions,
} from "@/lib/constants/enum-labels";
import {
  schoolHeadProfileSchema,
  YEARS_IN_SERVICE_MIN,
  YEARS_IN_SERVICE_MAX,
  type SchoolHeadProfileInput,
} from "@/lib/validators/profile.schema";
import { PROFILING_GRADE_LEVEL_TYPES } from "@/lib/validators/grade-level.schema";
import { isValidPhPhone, PH_PHONE_HINT } from "@/lib/validators/phone";
import { saveSchoolHeadProfile } from "@/lib/actions/school-head";
import { toFormData } from "@/lib/forms/to-form-data";
import { SCHOOL_HEAD_ROUTES } from "@/lib/routes/school-head";

/** Default School Head position when none is stored yet (read-only in UI). */
export const SH_DEFAULT_POSITION = "PRINCIPAL_I" as const;

const SECTIONS_PER_GRADE_MIN = 1;
const SECTIONS_PER_GRADE_MAX = 26;

const PROFILING_GRADE_SET = new Set<string>(PROFILING_GRADE_LEVEL_TYPES);
const PROFILING_GRADE_LEVEL_LABELS = Object.fromEntries(
  PROFILING_GRADE_LEVEL_TYPES.map((type) => [type, GRADE_LEVEL_LABELS[type] ?? type])
);

const SH_STEPS: WizardStepDef[] = [
  { id: "respondent", shortLabel: "Respondent", title: "Respondent Information" },
  { id: "professional", shortLabel: "Background", title: "Professional Background" },
  { id: "training", shortLabel: "Training", title: "Training & Professional Development" },
  { id: "school", shortLabel: "School", title: "School Structure" },
  { id: "review", shortLabel: "Review", title: "Review & Submit" },
];

const shWizardFormSchema = z.object({
  firstName: z.string(),
  middleName: z.string(),
  lastName: z.string(),
  contactNumber: z.string(),
  designation: z.literal("School Head"),
  position: z.string(),
  educationalAttainment: z.string(),
  fieldOfSpecialization: z.string(),
  specializationOther: z.string(),
  yearsInService: z.string(),
  hasReadingTraining: z.boolean().optional(),
  readingTrainings: z.array(z.string()),
  hasEnglishTraining: z.boolean().optional(),
  englishTrainings: z.array(z.string()),
  highestTrainingLevel: z.string(),
  gradeTypes: z.array(z.string()),
  sectionsPerGrade: z.string(),
});

type ExistingGradeStat = {
  type: string;
  activeSections: number;
  letterSections: number;
};

type Defaults = {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  accountEmail?: string;
  accountEmailIsSynthetic?: boolean;
  contactNumber?: string | null;
  designation?: string | null;
  position?: string;
  educationalAttainment?: string;
  fieldOfSpecialization?: string;
  specializationOther?: string | null;
  yearsInService?: number | string | null;
  hasReadingTraining?: boolean;
  readingTrainings?: string[];
  hasEnglishTraining?: boolean;
  englishTrainings?: string[];
  highestTrainingLevel?: string;
  /** Prefill: active grade level types for the school. */
  gradeTypes?: string[];
  /** Prefill: max active section count among school grades, or 1. */
  sectionsPerGrade?: number;
  /** Per-type section stats for projected totals (not submitted). */
  existingGradeStats?: ExistingGradeStat[];
};

type SHFormValues = z.infer<typeof shWizardFormSchema>;

function labelOf(map: Record<string, string>, value?: string | null) {
  if (!value) return "—";
  return map[value] ?? value;
}

function buildPayload(values: SHFormValues): Record<string, unknown> {
  return {
    firstName: values.firstName.trim(),
    middleName: values.middleName.trim() || undefined,
    lastName: values.lastName.trim(),
    contactNumber: values.contactNumber.trim() || undefined,
    designation: "School Head",
    position: values.position || SH_DEFAULT_POSITION,
    educationalAttainment: values.educationalAttainment || undefined,
    fieldOfSpecialization: values.fieldOfSpecialization || undefined,
    specializationOther:
      values.fieldOfSpecialization === "OTHERS"
        ? values.specializationOther.trim() || undefined
        : undefined,
    yearsInService:
      values.yearsInService === "" || values.yearsInService === undefined
        ? undefined
        : values.yearsInService,
    hasReadingTraining: values.hasReadingTraining,
    readingTrainings:
      values.hasReadingTraining === true ? values.readingTrainings : [],
    hasEnglishTraining: values.hasEnglishTraining,
    englishTrainings:
      values.hasEnglishTraining === true ? values.englishTrainings : [],
    highestTrainingLevel: values.highestTrainingLevel || undefined,
  };
}

function parseSectionsPerGrade(raw: string): number | null {
  const n = Number(String(raw).trim());
  if (!Number.isInteger(n)) return null;
  if (n < SECTIONS_PER_GRADE_MIN || n > SECTIONS_PER_GRADE_MAX) return null;
  return n;
}

/** Projected active section total after bootstrap (additive; never deletes). */
function projectedSectionTotal(
  gradeTypes: string[],
  sectionsPerGrade: number,
  statsByType: Record<string, ExistingGradeStat>
): number {
  return gradeTypes.reduce((sum, type) => {
    const stat = statsByType[type];
    const active = stat?.activeSections ?? 0;
    return sum + Math.max(active, sectionsPerGrade);
  }, 0);
}

export function SchoolHeadProfileForm({
  defaultValues,
  presentation = "wizard",
}: {
  defaultValues: Defaults;
  /** `wizard` = onboarding steps; `edit` = flat settings profile (no Review / School Structure UI). */
  presentation?: "wizard" | "edit";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const isEdit = presentation === "edit";

  const lockedPosition =
    defaultValues.position && defaultValues.position in SCHOOL_HEAD_POSITION_LABELS
      ? defaultValues.position
      : SH_DEFAULT_POSITION;

  const statsByType = Object.fromEntries(
    (defaultValues.existingGradeStats ?? []).map((s) => [s.type, s])
  );

  const form = useAppForm<SHFormValues>({
    schema: shWizardFormSchema,
    mode: "onTouched",
    defaultValues: {
      firstName: defaultValues.firstName ?? "",
      middleName: defaultValues.middleName ?? "",
      lastName: defaultValues.lastName ?? "",
      contactNumber: defaultValues.contactNumber ?? "",
      designation: "School Head",
      position: lockedPosition,
      educationalAttainment: defaultValues.educationalAttainment ?? "",
      fieldOfSpecialization: defaultValues.fieldOfSpecialization ?? "",
      specializationOther: defaultValues.specializationOther ?? "",
      yearsInService:
        defaultValues.yearsInService === null ||
        defaultValues.yearsInService === undefined
          ? ""
          : String(defaultValues.yearsInService),
      hasReadingTraining: defaultValues.hasReadingTraining,
      readingTrainings: defaultValues.readingTrainings ?? [],
      hasEnglishTraining: defaultValues.hasEnglishTraining,
      englishTrainings: defaultValues.englishTrainings ?? [],
      highestTrainingLevel: defaultValues.highestTrainingLevel ?? "",
      gradeTypes: (defaultValues.gradeTypes ?? []).filter((t) =>
        PROFILING_GRADE_SET.has(t)
      ),
      sectionsPerGrade: String(
        defaultValues.sectionsPerGrade &&
          defaultValues.sectionsPerGrade >= SECTIONS_PER_GRADE_MIN
          ? defaultValues.sectionsPerGrade
          : 1
      ),
    },
  });

  const specialization = form.watch("fieldOfSpecialization");
  const hasReading = form.watch("hasReadingTraining");
  const hasEnglish = form.watch("hasEnglishTraining");
  const gradeTypes = form.watch("gradeTypes");
  const sectionsPerGradeRaw = form.watch("sectionsPerGrade");
  const values = form.watch();

  const sectionsPerGradeParsed = parseSectionsPerGrade(sectionsPerGradeRaw);
  const gradeCount = gradeTypes.length;
  const sectionTotal =
    sectionsPerGradeParsed != null
      ? projectedSectionTotal(gradeTypes, sectionsPerGradeParsed, statsByType)
      : null;

  async function validateStep(
    index: number,
    opts?: { clear?: boolean }
  ): Promise<boolean> {
    const v = form.getValues();
    if (opts?.clear !== false) form.clearErrors();
    let ok = true;

    if (index === 0) {
      if (!v.firstName.trim()) {
        form.setError("firstName", { message: "First name is required" });
        ok = false;
      }
      if (!v.lastName.trim()) {
        form.setError("lastName", { message: "Last name is required" });
        ok = false;
      }
      if (v.contactNumber.trim() && !isValidPhPhone(v.contactNumber)) {
        form.setError("contactNumber", { message: PH_PHONE_HINT });
        ok = false;
      }
    }

    if (index === 1) {
      if (!v.educationalAttainment) {
        form.setError("educationalAttainment", { message: "Required" });
        ok = false;
      }
      if (!v.fieldOfSpecialization) {
        form.setError("fieldOfSpecialization", { message: "Required" });
        ok = false;
      } else if (v.fieldOfSpecialization === "OTHERS" && !v.specializationOther.trim()) {
        form.setError("specializationOther", {
          message: "Specify specialization when Others is selected",
        });
        ok = false;
      }
      const yearsRaw = String(v.yearsInService ?? "").trim();
      if (!yearsRaw) {
        form.setError("yearsInService", { message: "Years in service is required" });
        ok = false;
      } else {
        const n = Number(yearsRaw);
        if (!Number.isInteger(n) || n < YEARS_IN_SERVICE_MIN || n > YEARS_IN_SERVICE_MAX) {
          form.setError("yearsInService", {
            message: `Enter a whole number from ${YEARS_IN_SERVICE_MIN} to ${YEARS_IN_SERVICE_MAX}`,
          });
          ok = false;
        }
      }
    }

    if (index === 2) {
      if (v.hasReadingTraining === undefined) {
        form.setError("hasReadingTraining", { message: "Required" });
        ok = false;
      } else if (v.hasReadingTraining && v.readingTrainings.length === 0) {
        form.setError("readingTrainings", {
          message: "Select at least one reading training when Yes is selected",
        });
        ok = false;
      }
      if (v.hasEnglishTraining === undefined) {
        form.setError("hasEnglishTraining", { message: "Required" });
        ok = false;
      } else if (v.hasEnglishTraining && v.englishTrainings.length === 0) {
        form.setError("englishTrainings", {
          message: "Select at least one English curriculum training when Yes is selected",
        });
        ok = false;
      }
      if (!v.highestTrainingLevel) {
        form.setError("highestTrainingLevel", { message: "Required" });
        ok = false;
      }
    }

    if (index === 3) {
      if (!v.gradeTypes.length) {
        form.setError("gradeTypes", {
          message: "Select at least one grade level",
        });
        ok = false;
      }
      const sectionsRaw = String(v.sectionsPerGrade ?? "").trim();
      if (!sectionsRaw) {
        form.setError("sectionsPerGrade", {
          message: "Sections per grade is required",
        });
        ok = false;
      } else {
        const n = Number(sectionsRaw);
        if (
          !Number.isInteger(n) ||
          n < SECTIONS_PER_GRADE_MIN ||
          n > SECTIONS_PER_GRADE_MAX
        ) {
          form.setError("sectionsPerGrade", {
            message: `Enter a whole number from ${SECTIONS_PER_GRADE_MIN} to ${SECTIONS_PER_GRADE_MAX}`,
          });
          ok = false;
        }
      }
    }

    return ok;
  }

  async function submitProfile(opts: {
    onSuccess: () => void;
    /** When set, bootstrap school structure; omit in settings edit to leave grades untouched. */
    structure?: { gradeTypes: string[]; sectionsPerGrade: number };
  }) {
    const formValues = form.getValues();
    const payload = buildPayload(formValues);
    const parsed = schoolHeadProfileSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }

    startTransition(async () => {
      const res = await saveSchoolHeadProfile(
        toFormData({
          ...(parsed.data as SchoolHeadProfileInput),
          ...(opts.structure
            ? {
                gradeTypes: opts.structure.gradeTypes,
                sectionsPerGrade: opts.structure.sectionsPerGrade,
              }
            : { skipSchoolStructure: true }),
        })
      );
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      markFormClean(form);
      toast.success("Profile saved");
      opts.onSuccess();
    });
  }

  async function handleSave() {
    form.clearErrors();
    let ok = true;
    ok = (await validateStep(0, { clear: false })) && ok;
    ok = (await validateStep(1, { clear: false })) && ok;
    ok = (await validateStep(2, { clear: false })) && ok;
    if (!ok) return;

    // Settings edit: omit School Structure UI; do not mutate grades/sections on save.
    await submitProfile({
      onSuccess: () => router.refresh(),
    });
  }

  async function handleContinue() {
    if (step < SH_STEPS.length - 1) {
      const ok = await validateStep(step);
      if (!ok) return;
      setStep((s) => s + 1);
      return;
    }

    const okSchool = await validateStep(3);
    if (!okSchool) {
      setStep(3);
      return;
    }

    const formValues = form.getValues();
    const sectionsPerGrade = parseSectionsPerGrade(formValues.sectionsPerGrade);
    if (sectionsPerGrade == null || formValues.gradeTypes.length === 0) {
      toast.error("Complete the School Structure step");
      setStep(3);
      return;
    }

    await submitProfile({
      structure: {
        gradeTypes: formValues.gradeTypes,
        sectionsPerGrade,
      },
      // Land on grade levels so the SH can review/rename the bootstrapped sections.
      onSuccess: () => router.push(SCHOOL_HEAD_ROUTES.schoolGradeLevels),
    });
  }

  const accountHint = defaultValues.accountEmailIsSynthetic
    ? "Synthetic login identity — not used for email recovery."
    : undefined;

  const gradeLabelsSummary =
    values.gradeTypes
      .map((t) => GRADE_LEVEL_LABELS[t] ?? t)
      .join(", ") || "—";

  const sections = (
    <>
      {isEdit || step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isEdit ? "Account" : "I. Respondent Information"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <FormTextField
                control={form.control}
                name="firstName"
                label="First name"
                required
              />
              <FormTextField
                control={form.control}
                name="middleName"
                label="Middle name"
                description="Optional"
              />
              <FormTextField
                control={form.control}
                name="lastName"
                label="Last name"
                required
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <ReadOnlyField
                label="Email address"
                value={defaultValues.accountEmail ?? ""}
                hint={accountHint}
              />
              <FormTextField
                control={form.control}
                name="contactNumber"
                label="Contact number"
                type="tel"
                autoComplete="tel"
                inputMode="tel"
                description="Optional. PH number, e.g. 09171234567 or +639171234567."
              />
              <ReadOnlyField
                label="Designation"
                value="School Head"
                hint="Fixed for school head accounts."
              />
              <ReadOnlyField
                label="Position"
                value={labelOf(SCHOOL_HEAD_POSITION_LABELS, lockedPosition)}
                hint="Default school head position for this profile."
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      {isEdit || step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isEdit ? "Professional background" : "II. Professional Background"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormSelectField
              control={form.control}
              name="educationalAttainment"
              label="Highest Educational Attainment"
              required
              options={toOptions(EDUCATIONAL_ATTAINMENT_LABELS)}
            />
            <FormSelectField
              control={form.control}
              name="fieldOfSpecialization"
              label="Field of Specialization"
              required
              options={toOptions(SPECIALIZATION_LABELS)}
              onValueChange={(v) => {
                if (v !== "OTHERS") form.setValue("specializationOther", "");
              }}
            />
            {specialization === "OTHERS" ? (
              <FormTextField
                control={form.control}
                name="specializationOther"
                label="Specify specialization"
                required
              />
            ) : null}
            <FormTextField
              control={form.control}
              name="yearsInService"
              label="Years in Service"
              required
              type="number"
              inputMode="numeric"
              min={YEARS_IN_SERVICE_MIN}
              max={YEARS_IN_SERVICE_MAX}
              step={1}
              description={`Whole number from ${YEARS_IN_SERVICE_MIN} to ${YEARS_IN_SERVICE_MAX}.`}
              placeholder="e.g. 5"
            />
          </CardContent>
        </Card>
      ) : null}

      {isEdit || step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isEdit ? "Training" : "IV. Training & Professional Development"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormYesNoPills
              control={form.control}
              name="hasReadingTraining"
              label="Have you attended trainings related to literacy/reading instruction?"
              required
              onValueChange={(yes) => {
                if (!yes) form.setValue("readingTrainings", []);
              }}
            />
            {hasReading === true ? (
              <FormCheckboxChips
                control={form.control}
                name="readingTrainings"
                label="Recent reading trainings (last 5 years)"
                required
                options={toOptions(READING_TRAINING_LABELS)}
                description={'"None at all" cannot be combined with other options.'}
              />
            ) : null}
            <FormYesNoPills
              control={form.control}
              name="hasEnglishTraining"
              label="Have you attended trainings related to English Curriculum Instruction?"
              required
              onValueChange={(yes) => {
                if (!yes) form.setValue("englishTrainings", []);
              }}
            />
            {hasEnglish === true ? (
              <FormCheckboxChips
                control={form.control}
                name="englishTrainings"
                label="Recent English curriculum trainings (last 5 years)"
                required
                options={toOptions(ENGLISH_TRAINING_LABELS)}
                description={'"None at all" cannot be combined with other options.'}
              />
            ) : null}
            <FormSelectField
              control={form.control}
              name="highestTrainingLevel"
              label="Highest level of trainings attended"
              required
              options={toOptions(TRAINING_LEVEL_LABELS)}
            />
          </CardContent>
        </Card>
      ) : null}

      {!isEdit && step === 3 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">School Structure</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormCheckboxChips
              control={form.control}
              name="gradeTypes"
              label="Which grade levels does this school have?"
              required
              selectAll
              options={toOptions(PROFILING_GRADE_LEVEL_LABELS)}
              description="Select every grade level offered. Existing grades stay; you can add more here."
            />
            <FormTextField
              control={form.control}
              name="sectionsPerGrade"
              label="Sections per grade"
              required
              type="number"
              inputMode="numeric"
              min={SECTIONS_PER_GRADE_MIN}
              max={SECTIONS_PER_GRADE_MAX}
              step={1}
              description={`Letter sections A, B, C… will be created for each selected grade (up to ${SECTIONS_PER_GRADE_MAX}). Existing sections are kept; this only adds up to the floor you set.`}
              placeholder="e.g. 2"
            />
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {gradeCount === 0
                ? "Select at least one grade level."
                : sectionsPerGradeParsed == null
                  ? `${gradeCount} grade${gradeCount === 1 ? "" : "s"} · enter sections per grade (1–26)`
                  : `${gradeCount} grade${gradeCount === 1 ? "" : "s"} · ${sectionTotal} section${sectionTotal === 1 ? "" : "s"} total`}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!isEdit && step === 4 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Review & Submit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <ReviewBlock
              title="Respondent Information"
              onEdit={() => setStep(0)}
              rows={[
                [
                  "Name",
                  [values.firstName, values.middleName, values.lastName]
                    .filter(Boolean)
                    .join(" ") || "—",
                ],
                ["Email address", defaultValues.accountEmail ?? "—"],
                ["Contact number", values.contactNumber || "—"],
                ["Designation", "School Head"],
                ["Position", labelOf(SCHOOL_HEAD_POSITION_LABELS, values.position)],
              ]}
            />
            <ReviewBlock
              title="Professional Background"
              onEdit={() => setStep(1)}
              rows={[
                [
                  "Educational attainment",
                  labelOf(EDUCATIONAL_ATTAINMENT_LABELS, values.educationalAttainment),
                ],
                [
                  "Specialization",
                  values.fieldOfSpecialization === "OTHERS"
                    ? values.specializationOther || "Others"
                    : labelOf(SPECIALIZATION_LABELS, values.fieldOfSpecialization),
                ],
                [
                  "Years in service",
                  values.yearsInService === "" || values.yearsInService === undefined
                    ? "—"
                    : `${values.yearsInService} years`,
                ],
              ]}
            />
            <ReviewBlock
              title="Training & Professional Development"
              onEdit={() => setStep(2)}
              rows={[
                [
                  "Reading trainings",
                  values.hasReadingTraining === true
                    ? values.readingTrainings
                        .map(
                          (t) =>
                            READING_TRAINING_LABELS[t as keyof typeof READING_TRAINING_LABELS] ?? t
                        )
                        .join(", ") || "—"
                    : values.hasReadingTraining === false
                      ? "No"
                      : "—",
                ],
                [
                  "English trainings",
                  values.hasEnglishTraining === true
                    ? values.englishTrainings
                        .map(
                          (t) =>
                            ENGLISH_TRAINING_LABELS[t as keyof typeof ENGLISH_TRAINING_LABELS] ?? t
                        )
                        .join(", ") || "—"
                    : values.hasEnglishTraining === false
                      ? "No"
                      : "—",
                ],
                [
                  "Highest training level",
                  labelOf(TRAINING_LEVEL_LABELS, values.highestTrainingLevel),
                ],
              ]}
            />
            <ReviewBlock
              title="School Structure"
              onEdit={() => setStep(3)}
              rows={[
                ["Grade levels", gradeLabelsSummary],
                [
                  "Sections per grade",
                  sectionsPerGradeParsed != null
                    ? String(sectionsPerGradeParsed)
                    : values.sectionsPerGrade || "—",
                ],
                [
                  "Projected total",
                  gradeCount === 0 || sectionTotal == null
                    ? "—"
                    : `${gradeCount} grade${gradeCount === 1 ? "" : "s"} · ${sectionTotal} section${sectionTotal === 1 ? "" : "s"}`,
                ],
              ]}
            />
          </CardContent>
        </Card>
      ) : null}
    </>
  );

  return (
    <AppForm
      form={form}
      enableUnsavedGuard
      unsavedMessage="You have unsaved profiling changes. Leave this page? Your progress will be lost."
      onSubmit={() => {
        void (isEdit ? handleSave() : handleContinue());
      }}
      className="space-y-6"
    >
      {isEdit ? (
        <div className="space-y-6">
          {sections}
          <Button
            type="submit"
            loading={pending}
            loadingText="Saving…"
            className="min-w-[7.5rem]"
          >
            Save profile
          </Button>
        </div>
      ) : (
        <ProfileWizardChrome
          steps={SH_STEPS}
          currentStep={step}
          pending={pending}
          onBack={() => setStep((s) => Math.max(0, s - 1))}
          onContinue={() => void handleContinue()}
        >
          {sections}
        </ProfileWizardChrome>
      )}
    </AppForm>
  );
}

function ReviewBlock({
  title,
  rows,
  onEdit,
}: {
  title: string;
  rows: [string, string][];
  onEdit: () => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border/80 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Button type="button" variant="outline" size="sm" onClick={onEdit}>
          Edit
        </Button>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{k}</dt>
            <dd className="truncate text-sm font-medium">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
