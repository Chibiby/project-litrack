"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppForm, useAppForm, markFormClean } from "@/components/forms/app-form";
import { ProfileWizardChrome, type WizardStepDef } from "@/components/forms/profiling/wizard-chrome";
import {
  FormCheckboxChips,
  FormOptionPills,
  FormSelectField,
  FormTextField,
  FormYesNoPills,
  ReadOnlyField,
} from "@/components/forms/profiling/wizard-fields";
import {
  TEACHER_POSITION_LABELS,
  EDUCATIONAL_ATTAINMENT_LABELS,
  SPECIALIZATION_LABELS,
  TRAINING_LEVEL_LABELS,
  READING_TRAINING_LABELS,
  ENGLISH_TRAINING_LABELS,
  GRADE_LEVEL_LABELS,
  toOptions,
} from "@/lib/constants/enum-labels";
import {
  teacherProfileSchema,
  TEACHER_RANK_POSITIONS,
  MASTER_TEACHER_RANK_POSITIONS,
  YEARS_IN_SERVICE_MIN,
  YEARS_IN_SERVICE_MAX,
  ARAL_VOLUNTEER_DESIGNATION,
  type TeacherProfileInput,
} from "@/lib/validators/profile.schema";
import { isValidPhPhone, PH_PHONE_HINT } from "@/lib/validators/phone";
import { saveTeacherProfile } from "@/lib/actions/teacher";
import { toFormData } from "@/lib/forms/to-form-data";

/** RHF shape for the wizard UI (maps to teacherProfileSchema on submit). */
const teacherWizardFormSchema = z.object({
  firstName: z.string(),
  middleName: z.string(),
  lastName: z.string(),
  contactNumber: z.string(),
  designationKind: z.enum([
    "Teacher",
    "Master Teacher",
    ARAL_VOLUNTEER_DESIGNATION,
    "__OTHER__",
    "",
  ]),
  designationOther: z.string(),
  position: z.string().optional(),
  educationalAttainment: z.string(),
  fieldOfSpecialization: z.string(),
  specializationOther: z.string(),
  yearsInService: z.string(),
  yearsInServiceApplicable: z.boolean(),
  currentGradeAssignment: z.string().optional(),
  sectionId: z.string().optional(),
  hasReadingTraining: z.boolean().optional(),
  readingTrainings: z.array(z.string()),
  hasEnglishTraining: z.boolean().optional(),
  englishTrainings: z.array(z.string()),
  highestTrainingLevel: z.string(),
});

const TEACHER_STEPS: WizardStepDef[] = [
  { id: "respondent", shortLabel: "Respondent", title: "Respondent Information" },
  { id: "professional", shortLabel: "Background", title: "Professional Background" },
  { id: "assignment", shortLabel: "Assignment", title: "Teaching Assignment" },
  { id: "training", shortLabel: "Training", title: "Training & Professional Development" },
  { id: "review", shortLabel: "Review", title: "Review & Submit" },
];

const DESIGNATION_KIND_OPTIONS = [
  { value: "Teacher", label: "Teacher" },
  { value: "Master Teacher", label: "Master Teacher" },
  { value: ARAL_VOLUNTEER_DESIGNATION, label: "Non-DepEd ARAL Volunteer" },
  { value: "__OTHER__", label: "Others" },
];

type Defaults = Partial<{
  firstName: string;
  middleName: string;
  lastName: string;
  accountEmail: string;
  accountEmailIsSynthetic: boolean;
  contactNumber: string | null;
  designation: string | null;
  position: string | null;
  educationalAttainment: string;
  fieldOfSpecialization: string;
  specializationOther: string | null;
  yearsInService: number | string | null;
  /**
   * Client-only override, not sourced from the server today (no caller passes
   * it yet) — kept on `Defaults` for shape parity with `TeacherFormValues`.
   * The actual initial derivation instead inspects `yearsInService`'s presence,
   * see `resolveYearsInServiceApplicable`.
   */
  yearsInServiceApplicable: boolean;
  currentGradeAssignment: string | null;
  /** Teacher's current advisory section (`User.advisorySectionId`), not a TeacherProfile column. */
  sectionId: string | null;
  hasReadingTraining: boolean;
  readingTrainings: string[];
  hasEnglishTraining: boolean;
  englishTrainings: string[];
  highestTrainingLevel: string;
}>;

/** Client form values — booleans may be unset until the user chooses. */
type TeacherFormValues = {
  firstName: string;
  middleName: string;
  lastName: string;
  contactNumber: string;
  designationKind:
    | "Teacher"
    | "Master Teacher"
    | typeof ARAL_VOLUNTEER_DESIGNATION
    | "__OTHER__"
    | "";
  designationOther: string;
  position: string | undefined;
  educationalAttainment: string;
  fieldOfSpecialization: string;
  specializationOther: string;
  yearsInService: string;
  yearsInServiceApplicable: boolean;
  currentGradeAssignment: string | undefined;
  sectionId: string | undefined;
  hasReadingTraining: boolean | undefined;
  readingTrainings: string[];
  hasEnglishTraining: boolean | undefined;
  englishTrainings: string[];
  highestTrainingLevel: string;
};

function resolveDesignationKind(raw?: string | null): {
  kind: TeacherFormValues["designationKind"];
  other: string;
} {
  if (!raw) return { kind: "", other: "" };
  if (raw === "Teacher" || raw === "Master Teacher") return { kind: raw, other: "" };
  if (raw === "School Head") return { kind: "", other: "" };
  if (raw === ARAL_VOLUNTEER_DESIGNATION) return { kind: ARAL_VOLUNTEER_DESIGNATION, other: "" };
  return { kind: "__OTHER__", other: raw };
}

/**
 * Client-only initial value for `yearsInServiceApplicable`. Distinguishes a
 * brand-new profile (no `TeacherProfile` row yet, so `yearsInService` is
 * absent from `defaultValues` entirely — assume applicable, most new
 * teachers do have a number to enter) from an existing profile that was
 * previously saved with years-in-service explicitly cleared to N/A (the key
 * is present but `null` — stay N/A).
 */
function resolveYearsInServiceApplicable(defaults: Defaults): boolean {
  if (!("yearsInService" in defaults)) return true;
  return defaults.yearsInService !== null && defaults.yearsInService !== undefined;
}

function labelOf(map: Record<string, string>, value?: string | null) {
  if (!value) return "—";
  return map[value] ?? value;
}

function buildPayload(values: TeacherFormValues): Record<string, unknown> {
  const designation =
    values.designationKind === "__OTHER__"
      ? values.designationOther.trim()
      : values.designationKind;

  const payload: Record<string, unknown> = {
    firstName: values.firstName.trim(),
    middleName: values.middleName.trim() || undefined,
    lastName: values.lastName.trim(),
    contactNumber: values.contactNumber.trim() || undefined,
    designation,
    educationalAttainment: values.educationalAttainment || undefined,
    fieldOfSpecialization: values.fieldOfSpecialization || undefined,
    yearsInService: values.yearsInServiceApplicable
      ? values.yearsInService || undefined
      : undefined,
    currentGradeAssignment: values.currentGradeAssignment,
    sectionId: values.sectionId || undefined,
    hasReadingTraining: values.hasReadingTraining,
    readingTrainings:
      values.hasReadingTraining === true ? values.readingTrainings : [],
    hasEnglishTraining: values.hasEnglishTraining,
    englishTrainings:
      values.hasEnglishTraining === true ? values.englishTrainings : [],
    highestTrainingLevel: values.highestTrainingLevel || undefined,
  };

  if (values.fieldOfSpecialization === "OTHERS") {
    payload.specializationOther = values.specializationOther.trim() || undefined;
  }

  if (values.designationKind === "Teacher" || values.designationKind === "Master Teacher") {
    payload.position = values.position || undefined;
  }

  return payload;
}

const STEP_FIELDS: (keyof TeacherFormValues)[][] = [
  [
    "firstName",
    "middleName",
    "lastName",
    "contactNumber",
    "designationKind",
    "designationOther",
    "position",
  ],
  [
    "educationalAttainment",
    "fieldOfSpecialization",
    "specializationOther",
    "yearsInService",
    "yearsInServiceApplicable",
  ],
  ["currentGradeAssignment", "sectionId"],
  [
    "hasReadingTraining",
    "readingTrainings",
    "hasEnglishTraining",
    "englishTrainings",
    "highestTrainingLevel",
  ],
  [],
];

export function TeacherProfileForm({
  defaultValues,
  presentation = "wizard",
  gradeLevels,
}: {
  defaultValues: Defaults;
  /** `wizard` = onboarding steps; `edit` = flat settings profile (no Review). */
  presentation?: "wizard" | "edit";
  /** Active grades + their sections, for the grade→section cascade in Step 3. */
  gradeLevels: {
    id: string;
    type: string;
    sections: { id: string; name: string; takenByOther: boolean }[];
  }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [step, setStep] = useState(0);
  const isEdit = presentation === "edit";
  const initialDesig = resolveDesignationKind(defaultValues.designation);
  // Tracks whether the user has explicitly toggled the years-in-service
  // Yes/No pills in this session, so switching designation to the ARAL
  // Volunteer kind only pre-selects N/A when they haven't made a choice yet.
  const yearsInServiceTouchedRef = useRef(false);

  const form = useAppForm<TeacherFormValues>({
    // UI schema for RHF; server teacherProfileSchema validates on Save.
    schema: teacherWizardFormSchema,
    mode: "onTouched",
    defaultValues: {
      firstName: defaultValues.firstName ?? "",
      middleName: defaultValues.middleName ?? "",
      lastName: defaultValues.lastName ?? "",
      contactNumber: defaultValues.contactNumber ?? "",
      designationKind: initialDesig.kind,
      designationOther: initialDesig.other,
      position: defaultValues.position ?? undefined,
      educationalAttainment: defaultValues.educationalAttainment ?? "",
      fieldOfSpecialization: defaultValues.fieldOfSpecialization ?? "",
      specializationOther: defaultValues.specializationOther ?? "",
      yearsInService:
        defaultValues.yearsInService === null ||
        defaultValues.yearsInService === undefined
          ? ""
          : String(defaultValues.yearsInService),
      yearsInServiceApplicable: resolveYearsInServiceApplicable(defaultValues),
      currentGradeAssignment: defaultValues.currentGradeAssignment ?? undefined,
      sectionId: defaultValues.sectionId ?? undefined,
      hasReadingTraining: defaultValues.hasReadingTraining,
      readingTrainings: defaultValues.readingTrainings ?? [],
      hasEnglishTraining: defaultValues.hasEnglishTraining,
      englishTrainings: defaultValues.englishTrainings ?? [],
      highestTrainingLevel: defaultValues.highestTrainingLevel ?? "",
    },
  });

  const designationKind = form.watch("designationKind");
  const specialization = form.watch("fieldOfSpecialization");
  const yearsInServiceApplicable = form.watch("yearsInServiceApplicable");
  const hasReading = form.watch("hasReadingTraining");
  const hasEnglish = form.watch("hasEnglishTraining");
  const values = form.watch();

  // A designation only needs an advisory section when it corresponds to an
  // actual classroom teaching role; the ARAL Volunteer designation does not.
  const sectionRequired = designationKind !== ARAL_VOLUNTEER_DESIGNATION;

  const gradeOptions = useMemo(
    () =>
      gradeLevels.map((g) => ({
        value: g.type,
        label: GRADE_LEVEL_LABELS[g.type] ?? g.type,
        // A fully-booked grade (no open section) is only disabled for
        // designations that actually need a section; never disable the
        // grade the field is currently set to, so editing an existing
        // profile never strands the teacher on an unselectable value.
        disabled:
          sectionRequired &&
          !g.sections.some((s) => !s.takenByOther) &&
          g.type !== values.currentGradeAssignment,
      })),
    [gradeLevels, sectionRequired, values.currentGradeAssignment]
  );

  const sectionOptions = useMemo(() => {
    const grade = gradeLevels.find((g) => g.type === values.currentGradeAssignment);
    return (grade?.sections ?? []).map((s) => ({
      value: s.id,
      label: s.name,
      // Self-exclusion: a teacher editing their own profile never sees
      // their own current section disabled.
      disabled: s.takenByOther && s.id !== values.sectionId,
    }));
  }, [gradeLevels, values.currentGradeAssignment, values.sectionId]);

  const teacherPositionOptions = useMemo(
    () =>
      toOptions(
        Object.fromEntries(
          TEACHER_RANK_POSITIONS.map((k) => [k, TEACHER_POSITION_LABELS[k]])
        )
      ),
    []
  );
  const masterPositionOptions = useMemo(
    () =>
      toOptions(
        Object.fromEntries(
          MASTER_TEACHER_RANK_POSITIONS.map((k) => [k, TEACHER_POSITION_LABELS[k]])
        )
      ),
    []
  );

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
      if (!v.designationKind) {
        form.setError("designationKind", { message: "Designation is required" });
        ok = false;
      } else if (v.designationKind === "__OTHER__" && !v.designationOther.trim()) {
        form.setError("designationOther", { message: "Specify designation" });
        ok = false;
      } else if (v.designationKind === "Teacher" && !v.position) {
        form.setError("position", { message: "Select a Teacher I–VII position" });
        ok = false;
      } else if (v.designationKind === "Master Teacher" && !v.position) {
        form.setError("position", {
          message: "Select a Master Teacher I–IV position",
        });
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
      if (v.yearsInServiceApplicable !== false) {
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
    }

    if (index === 2) {
      if (!v.currentGradeAssignment) {
        form.setError("currentGradeAssignment", { message: "Required" });
        ok = false;
      }
      if (v.designationKind !== ARAL_VOLUNTEER_DESIGNATION && !v.sectionId) {
        form.setError("sectionId", { message: "Select a section" });
        ok = false;
      }
    }

    if (index === 3) {
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

    if (!ok) {
      const first = STEP_FIELDS[index]?.find((f) => form.getFieldState(f).error);
      if (first) {
        try {
          form.setFocus(first);
        } catch {
          /* ignore */
        }
      }
    }
    return ok;
  }

  async function submitProfile(onSuccess: () => void) {
    const payload = buildPayload(form.getValues());
    const parsed = teacherProfileSchema.safeParse(payload);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Invalid input");
      return;
    }
    startTransition(async () => {
      const res = await saveTeacherProfile(toFormData(parsed.data as TeacherProfileInput));
      if (res.ok) {
        markFormClean(form);
        toast.success("Profile saved");
        onSuccess();
      } else toast.error(res.error);
    });
  }

  async function handleSave() {
    form.clearErrors();
    let ok = true;
    ok = (await validateStep(0, { clear: false })) && ok;
    ok = (await validateStep(1, { clear: false })) && ok;
    ok = (await validateStep(2, { clear: false })) && ok;
    ok = (await validateStep(3, { clear: false })) && ok;
    if (!ok) return;
    await submitProfile(() => router.refresh());
  }

  async function handleContinue() {
    if (step < TEACHER_STEPS.length - 1) {
      const ok = await validateStep(step);
      if (!ok) return;
      setStep((s) => s + 1);
      return;
    }
    // Review → submit
    await submitProfile(() => router.push("/teacher"));
  }

  const accountHint = defaultValues.accountEmailIsSynthetic
    ? "Synthetic login identity — not used for email recovery."
    : undefined;

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
            </div>
            <FormOptionPills
              control={form.control}
              name="designationKind"
              label="Designation"
              required
              options={DESIGNATION_KIND_OPTIONS}
              onValueChange={(kind) => {
                if (kind === "Teacher" || kind === "Master Teacher") {
                  form.setValue("designationOther", "");
                  const pos = form.getValues("position");
                  if (kind === "Teacher" && pos && !TEACHER_RANK_POSITIONS.includes(pos as (typeof TEACHER_RANK_POSITIONS)[number])) {
                    form.setValue("position", undefined);
                  }
                  if (
                    kind === "Master Teacher" &&
                    pos &&
                    !MASTER_TEACHER_RANK_POSITIONS.includes(
                      pos as (typeof MASTER_TEACHER_RANK_POSITIONS)[number]
                    )
                  ) {
                    form.setValue("position", undefined);
                  }
                } else {
                  form.setValue("position", undefined);
                  if (kind === ARAL_VOLUNTEER_DESIGNATION) {
                    // Pre-select N/A defaults for the ARAL Volunteer designation,
                    // but never clobber a value the user already chose.
                    if (!form.getValues("fieldOfSpecialization")) {
                      form.setValue("fieldOfSpecialization", "NA");
                    }
                    if (!yearsInServiceTouchedRef.current) {
                      form.setValue("yearsInServiceApplicable", false);
                    }
                  }
                }
              }}
            />
            {designationKind === "__OTHER__" ? (
              <FormTextField
                control={form.control}
                name="designationOther"
                label="Specify designation"
                required
              />
            ) : null}
            {designationKind === "Teacher" ? (
              <FormSelectField
                control={form.control}
                name="position"
                label="Position"
                required
                options={teacherPositionOptions}
                placeholder="Select Teacher I–VII"
              />
            ) : null}
            {designationKind === "Master Teacher" ? (
              <FormSelectField
                control={form.control}
                name="position"
                label="Position"
                required
                options={masterPositionOptions}
                placeholder="Select Master Teacher I–IV"
              />
            ) : null}
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
            <FormYesNoPills
              control={form.control}
              name="yearsInServiceApplicable"
              label="Do you have a specific number of years in service?"
              onValueChange={() => {
                yearsInServiceTouchedRef.current = true;
              }}
            />
            {yearsInServiceApplicable !== false ? (
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
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {isEdit || step === 2 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isEdit ? "Teaching assignment" : "III. Teaching Assignment"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormSelectField
              control={form.control}
              name="currentGradeAssignment"
              label="Current Grade Level / Assignment"
              description="The grade you're assigned to. Fully-booked grades are disabled unless you don't need a classroom section."
              required
              options={gradeOptions}
              placeholder="Select grade"
              onValueChange={(newGradeType) => {
                const grade = gradeLevels.find((g) => g.type === newGradeType);
                const currentSectionId = form.getValues("sectionId");
                const stillValid = currentSectionId
                  ? (grade?.sections ?? []).some((s) => s.id === currentSectionId)
                  : false;
                if (!stillValid) {
                  form.setValue("sectionId", undefined);
                }
              }}
            />
            <FormSelectField
              control={form.control}
              name="sectionId"
              label="Section"
              description={
                sectionRequired
                  ? "The classroom section you'll advise. Sections already taken by another teacher are disabled."
                  : "Optional for the ARAL Volunteer designation — you don't advise a classroom section."
              }
              required={sectionRequired}
              allowEmpty={!sectionRequired}
              emptyLabel="N/A — no classroom section"
              options={sectionOptions}
              placeholder={values.currentGradeAssignment ? "Select section" : "Select a grade first"}
            />
          </CardContent>
        </Card>
      ) : null}

      {isEdit || step === 3 ? (
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
              label="Trainings related to literacy/reading?"
              required
              onValueChange={(yes) => {
                if (!yes) form.setValue("readingTrainings", []);
              }}
            />
            {hasReading === true ? (
              <FormCheckboxChips
                control={form.control}
                name="readingTrainings"
                label="Recent reading trainings (last 5y)"
                required
                options={toOptions(READING_TRAINING_LABELS)}
                description={'"None at all" cannot be combined with other options.'}
              />
            ) : null}
            <FormYesNoPills
              control={form.control}
              name="hasEnglishTraining"
              label="Trainings related to English Curriculum?"
              required
              onValueChange={(yes) => {
                if (!yes) form.setValue("englishTrainings", []);
              }}
            />
            {hasEnglish === true ? (
              <FormCheckboxChips
                control={form.control}
                name="englishTrainings"
                label="Recent English trainings (last 5y)"
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

      {!isEdit && step === 4 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">V. Review & Submit</CardTitle>
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
                [
                  "Designation",
                  values.designationKind === "__OTHER__"
                    ? values.designationOther || "—"
                    : values.designationKind || "—",
                ],
                [
                  "Position",
                  values.designationKind === "Teacher" ||
                  values.designationKind === "Master Teacher"
                    ? labelOf(TEACHER_POSITION_LABELS, values.position)
                    : "—",
                ],
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
                  values.yearsInServiceApplicable === false
                    ? "N/A"
                    : values.yearsInService === "" || values.yearsInService === undefined
                      ? "—"
                      : `${values.yearsInService} years`,
                ],
              ]}
            />
            <ReviewBlock
              title="Teaching Assignment"
              onEdit={() => setStep(2)}
              rows={[
                [
                  "Grade assignment",
                  labelOf(GRADE_LEVEL_LABELS, values.currentGradeAssignment),
                ],
                [
                  "Section",
                  sectionOptions.find((s) => s.value === values.sectionId)?.label ?? "N/A",
                ],
              ]}
            />
            <ReviewBlock
              title="Training & Professional Development"
              onEdit={() => setStep(3)}
              rows={[
                [
                  "Reading trainings",
                  values.hasReadingTraining === true
                    ? values.readingTrainings
                        .map((t) => READING_TRAINING_LABELS[t as keyof typeof READING_TRAINING_LABELS] ?? t)
                        .join(", ") || "—"
                    : values.hasReadingTraining === false
                      ? "No"
                      : "—",
                ],
                [
                  "English trainings",
                  values.hasEnglishTraining === true
                    ? values.englishTrainings
                        .map((t) => ENGLISH_TRAINING_LABELS[t as keyof typeof ENGLISH_TRAINING_LABELS] ?? t)
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
          <Button type="submit" disabled={pending} className="min-w-[7.5rem]">
            {pending ? "Saving…" : "Save profile"}
          </Button>
        </div>
      ) : (
        <ProfileWizardChrome
          steps={TEACHER_STEPS}
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
