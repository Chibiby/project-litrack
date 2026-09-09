"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { toast } from "sonner";
import { AlertCircle, Lock, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppForm, useAppForm, markFormClean } from "@/components/forms/app-form";
import { FormErrorSummary } from "@/components/forms/form-error-summary";
import { ProfileWizardChrome, type WizardStepDef } from "@/components/forms/profiling/wizard-chrome";
import {
  TEACHER_PROFILING_STEPS,
  isLastTeacherStep,
  nextTeacherStep,
  previousTeacherStep,
  visiblePositionOf,
  visibleTeacherSteps,
} from "@/lib/teachers/profiling-steps";
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
  ETHNICITY_LABELS,
  formatEthnicities,
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
  ethnicity: z.string().optional(),
  ethnicityOther: z.string(),
  secondaryEthnicity: z.string().optional(),
  secondaryEthnicityOther: z.string(),
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

/**
 * Canonical step list. `step`, `STEP_FIELDS` and `stepOfField` are all indexes
 * into THIS array for everyone — a volunteer's wizard hides the Teaching
 * Assignment step but never renumbers the rest. The walk and the rail come from
 * `@/lib/teachers/profiling-steps`.
 */
const TEACHER_STEPS: WizardStepDef[] = [...TEACHER_PROFILING_STEPS];

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
  ethnicity: string | null;
  ethnicityOther: string | null;
  secondaryEthnicity: string | null;
  secondaryEthnicityOther: string | null;
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
  ethnicity: string | undefined;
  ethnicityOther: string;
  secondaryEthnicity: string | undefined;
  secondaryEthnicityOther: string;
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
    /*
      Two slots, and the second only carries meaning next to the first: with no
      first answer there is nothing for a second to be second to, so both are
      dropped together. Each free-text line is sent only while its own slot
      says Others, which is also how a slot changed away from Others gets its
      stale specify line cleared rather than saved.
    */
    ethnicity: values.ethnicity || undefined,
    ethnicityOther:
      values.ethnicity === "OTHER" ? values.ethnicityOther.trim() || undefined : undefined,
    secondaryEthnicity: values.ethnicity ? values.secondaryEthnicity || undefined : undefined,
    secondaryEthnicityOther:
      values.ethnicity && values.secondaryEthnicity === "OTHER"
        ? values.secondaryEthnicityOther.trim() || undefined
        : undefined,
    designation,
    educationalAttainment: values.educationalAttainment || undefined,
    fieldOfSpecialization: values.fieldOfSpecialization || undefined,
    yearsInService: values.yearsInServiceApplicable
      ? values.yearsInService || undefined
      : undefined,
    currentGradeAssignment: values.currentGradeAssignment || undefined,
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
    "ethnicity",
    "ethnicityOther",
    "secondaryEthnicity",
    "secondaryEthnicityOther",
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

/** Anchor for the server-error banner, so a failed save can scroll itself into view. */
const SAVE_ERROR_ID = "teacher-profile-save-error";

/**
 * Field → the label the teacher actually sees above it. A summary that lists
 * three bare "Required" lines names nothing; with these it names the fields,
 * which is the whole difference between "something is wrong" and "go fill in
 * Contact number". Keep in step with the labels in the JSX below.
 */
const FIELD_LABELS: Partial<Record<keyof TeacherFormValues, string>> = {
  firstName: "First name",
  middleName: "Middle name",
  lastName: "Last name",
  contactNumber: "Contact number",
  ethnicity: "Ethnicity",
  ethnicityOther: "Specify ethnicity",
  secondaryEthnicity: "Second ethnicity",
  secondaryEthnicityOther: "Specify second ethnicity",
  designationKind: "Designation",
  designationOther: "Specify designation",
  position: "Position",
  educationalAttainment: "Highest Educational Attainment",
  fieldOfSpecialization: "Field of Specialization",
  specializationOther: "Specify specialization",
  yearsInServiceApplicable: "Do you have a specific number of years in service?",
  yearsInService: "Years in Service",
  currentGradeAssignment: "Current Grade Level / Assignment",
  sectionId: "Section",
  hasReadingTraining: "Trainings related to literacy/reading?",
  readingTrainings: "Recent reading trainings (last 5y)",
  hasEnglishTraining: "Trainings related to English Curriculum?",
  englishTrainings: "Recent English trainings (last 5y)",
  highestTrainingLevel: "Highest level of trainings attended",
};

/** Which wizard step a field lives on, or -1 for a field on no step. */
function stepOfField(field: keyof TeacherFormValues): number {
  return STEP_FIELDS.findIndex((fields) => fields.includes(field));
}

/**
 * A payload key from `teacherProfileSchema` → the form field that produced it.
 *
 * `buildPayload` names every key after its field except `designation`, which is
 * assembled from the two designation controls — so that is the only translation
 * needed. Membership is checked against {@link FIELD_LABELS} on purpose: a key we
 * cannot name is a key we should not silently jump to, and it falls through to
 * being reported on its own instead.
 */
function payloadFieldFor(
  path: string,
  values: TeacherFormValues
): keyof TeacherFormValues | undefined {
  if (path === "designation") {
    return values.designationKind === "__OTHER__" ? "designationOther" : "designationKind";
  }
  const field = path as keyof TeacherFormValues;
  return FIELD_LABELS[field] ? field : undefined;
}

export function TeacherProfileForm({
  defaultValues,
  presentation = "wizard",
  gradeLevels,
  registeredAsAralVolunteer = false,
}: {
  defaultValues: Defaults;
  /** `wizard` = onboarding steps; `edit` = flat settings profile (no Review). */
  presentation?: "wizard" | "edit";
  /**
   * They ticked "I am a Non-DepEd ARAL Volunteer" when they registered
   * (`User.registeredAsAralVolunteer`).
   *
   * In the wizard this locks Designation to that value and drops the Teaching
   * Assignment step — a volunteer advises no section. The flat edit view
   * ignores it entirely, which is the escape hatch: a mis-tick is corrected in
   * Settings -> Profile, where Designation is an ordinary editable field.
   */
  registeredAsAralVolunteer?: boolean;
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
  /**
   * The server's reason for refusing the save, kept on screen rather than in a
   * toast. Half of these say retrying will not help, and a message that
   * disappears after four seconds cannot say that usefully.
   */
  const [saveError, setSaveError] = useState<string | null>(null);
  const isEdit = presentation === "edit";
  /**
   * Volunteer rules apply to the onboarding wizard only. In `edit` the whole
   * form is on one page and every field stays editable, so locking there would
   * remove the only way to undo a mis-ticked box at registration.
   */
  const volunteerWizard = !isEdit && registeredAsAralVolunteer;
  /** The rail: every step for a teacher, all but Teaching Assignment for a volunteer. */
  const wizardSteps = useMemo(
    () => visibleTeacherSteps(volunteerWizard) as WizardStepDef[],
    [volunteerWizard]
  );
  /**
   * Card heading numeral for a canonical step, counted over the steps this
   * person actually sees — so a volunteer reads I, II, III, IV rather than
   * I, II, IV, V with a hole where Teaching Assignment used to be.
   */
  const stepNumeral = (canonicalStep: number) =>
    ["I", "II", "III", "IV", "V"][visiblePositionOf(canonicalStep, volunteerWizard)];
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
      ethnicity: defaultValues.ethnicity ?? undefined,
      ethnicityOther: defaultValues.ethnicityOther ?? "",
      secondaryEthnicity: defaultValues.secondaryEthnicity ?? undefined,
      secondaryEthnicityOther: defaultValues.secondaryEthnicityOther ?? "",
      designationKind: initialDesig.kind,
      designationOther: initialDesig.other,
      position: defaultValues.position ?? undefined,
      educationalAttainment: defaultValues.educationalAttainment ?? "",
      // The N/A presets for a volunteer normally come from the Designation
      // pills' onValueChange. A locked designation is never "changed", so that
      // handler never runs and the seeding has to happen here instead.
      fieldOfSpecialization:
        defaultValues.fieldOfSpecialization ?? (volunteerWizard ? "NA" : ""),
      specializationOther: defaultValues.specializationOther ?? "",
      yearsInService:
        defaultValues.yearsInService === null ||
        defaultValues.yearsInService === undefined
          ? ""
          : String(defaultValues.yearsInService),
      yearsInServiceApplicable: volunteerWizard
        ? // Same reason as fieldOfSpecialization above: N/A is the volunteer
          // default, unless a saved profile already carries a number.
          resolveYearsInServiceApplicable(defaultValues) &&
          defaultValues.yearsInService !== undefined
        : resolveYearsInServiceApplicable(defaultValues),
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
  const ethnicity = form.watch("ethnicity");
  const secondaryEthnicity = form.watch("secondaryEthnicity");
  const specialization = form.watch("fieldOfSpecialization");
  const yearsInServiceApplicable = form.watch("yearsInServiceApplicable");
  const hasReading = form.watch("hasReadingTraining");
  const hasEnglish = form.watch("hasEnglishTraining");
  const values = form.watch();

  // A designation only needs a classroom assignment when it corresponds to an
  // actual teaching role. The ARAL Volunteer holds neither a grade nor a
  // section, so both fields go optional together — one flag, because there is
  // no designation where one applies and the other does not.
  const assignmentRequired = designationKind !== ARAL_VOLUNTEER_DESIGNATION;

  /*
    A second ethnicity is opt-in, so the field is not on screen until someone
    asks for it — but a profile that already carries one opens with it shown,
    otherwise editing would look like the answer had been lost.
  */
  const [showSecondEthnicity, setShowSecondEthnicity] = useState(
    Boolean(defaultValues.secondaryEthnicity)
  );

  function removeSecondEthnicity() {
    setShowSecondEthnicity(false);
    form.setValue("secondaryEthnicity", undefined);
    form.setValue("secondaryEthnicityOther", "");
  }

  /**
   * Runs after the first select has already written its own value. Everything
   * here is about the wreckage a change can leave behind: a specify line for a
   * slot that no longer says Others, and a second ethnicity that has either
   * lost the answer it was second to or become a duplicate of the new one.
   */
  function changeEthnicity(next: string) {
    if (next !== "OTHER") form.setValue("ethnicityOther", "");
    if (!next) {
      removeSecondEthnicity();
      return;
    }
    if (next !== "OTHER" && form.getValues("secondaryEthnicity") === next) {
      form.setValue("secondaryEthnicity", undefined);
      form.setValue("secondaryEthnicityOther", "");
    }
  }

  /*
    The first answer is dropped from the second list so the two can never be
    the same. "Others" survives the filter: someone of mixed heritage may have
    to write both halves in by hand, and those two lines are not duplicates.
  */
  const secondEthnicityOptions = useMemo(
    () =>
      toOptions(ETHNICITY_LABELS).filter((o) => o.value !== ethnicity || o.value === "OTHER"),
    [ethnicity]
  );

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
          assignmentRequired &&
          !g.sections.some((s) => !s.takenByOther) &&
          g.type !== values.currentGradeAssignment,
      })),
    [gradeLevels, assignmentRequired, values.currentGradeAssignment]
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

  // Resolve the section name across ALL grades, not just `sectionOptions` —
  // the Review step must still name the section if the grade field is cleared.
  const selectedSectionName = useMemo(() => {
    if (!values.sectionId) return null;
    for (const g of gradeLevels) {
      const match = g.sections.find((s) => s.id === values.sectionId);
      if (match) return match.name;
    }
    return null;
  }, [gradeLevels, values.sectionId]);

  /** No grade has an open section (and none is already ours) — profiling is stuck. */
  const noAssignableSections =
    assignmentRequired &&
    gradeLevels.every((g) =>
      g.sections.every((s) => s.takenByOther && s.id !== values.sectionId)
    );

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
      // Ethnicity itself is optional in both slots. Only the free-text line is
      // ever required, and only for the slot that asked for it.
      if (v.ethnicity === "OTHER" && !v.ethnicityOther.trim()) {
        form.setError("ethnicityOther", { message: "Please specify the ethnicity" });
        ok = false;
      }
      if (v.ethnicity && v.secondaryEthnicity === "OTHER" && !v.secondaryEthnicityOther.trim()) {
        form.setError("secondaryEthnicityOther", {
          message: "Please specify the second ethnicity",
        });
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
      const needsAssignment = v.designationKind !== ARAL_VOLUNTEER_DESIGNATION;
      if (needsAssignment && !v.currentGradeAssignment) {
        form.setError("currentGradeAssignment", { message: "Select a grade level" });
        ok = false;
      } else if (
        v.currentGradeAssignment &&
        !gradeOptions.some((o) => o.value === v.currentGradeAssignment)
      ) {
        // Stale/orphaned value (e.g. a legacy grade type or one the school
        // deactivated) that isn't among the currently-configured grades —
        // never silently submit it, force an explicit re-pick.
        form.setError("currentGradeAssignment", {
          message: "This grade is no longer available — select your current one",
        });
        ok = false;
      }
      if (needsAssignment && !v.sectionId) {
        form.setError("sectionId", { message: "Select a section" });
        ok = false;
      } else if (v.sectionId && !sectionOptions.some((o) => o.value === v.sectionId)) {
        form.setError("sectionId", {
          message: "This section is no longer available — select your current one",
        });
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
    setSaveError(null);
    const values = form.getValues();
    const payload = buildPayload(values);
    const parsed = teacherProfileSchema.safeParse(payload);
    if (!parsed.success) {
      // These issues are raised against the transformed payload, not the form,
      // so without this mapping they can only ever be toasted as text. Mapped,
      // each one marks its own field, names itself in the summary, and the
      // wizard can jump to the step that holds it.
      const fields: (keyof TeacherFormValues)[] = [];
      const unmapped: string[] = [];
      for (const issue of parsed.error.errors) {
        const field = payloadFieldFor(String(issue.path[0] ?? ""), values);
        if (!field) {
          unmapped.push(issue.message);
          continue;
        }
        if (!fields.includes(field)) fields.push(field);
        form.setError(field, { message: issue.message });
      }

      if (fields.length > 0) {
        // Earliest step first: sending someone to the last offending step would
        // make them walk back through the ones before it anyway.
        const steps = fields.map(stepOfField).filter((i) => i >= 0);
        const earliest = steps.length > 0 ? Math.min(...steps) : undefined;
        if (!isEdit && earliest !== undefined) setStep(earliest);
        const target =
          fields.find((f) => stepOfField(f) === earliest) ?? fields[0];
        // The field may live on a step that has only just been mounted.
        requestAnimationFrame(() => {
          try {
            form.setFocus(target);
          } catch {
            /* ignore */
          }
        });
        toast.error(
          fields.length === 1
            ? "1 field needs your attention"
            : `${fields.length} fields need your attention`
        );
      }
      // An issue we could not attach to a field still has to be said out loud.
      for (const message of unmapped) toast.error(message);
      return;
    }
    startTransition(async () => {
      const res = await saveTeacherProfile(toFormData(parsed.data as TeacherProfileInput));
      if (res.ok) {
        markFormClean(form);
        toast.success("Profile saved");
        onSuccess();
      } else {
        setSaveError(res.error);
        toast.error("Couldn't save your profile");
        requestAnimationFrame(() => {
          document
            .getElementById(SAVE_ERROR_ID)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    });
  }

  async function handleSave() {
    form.clearErrors();
    setSaveError(null);
    let ok = true;
    ok = (await validateStep(0, { clear: false })) && ok;
    ok = (await validateStep(1, { clear: false })) && ok;
    // Step 2 is Teaching Assignment. A volunteer never sees it, and its own
    // rules already exempt the designation — running it here would only be
    // wasted work, but skipping it keeps the two paths honest about that.
    if (!volunteerWizard) {
      ok = (await validateStep(2, { clear: false })) && ok;
    }
    ok = (await validateStep(3, { clear: false })) && ok;
    if (!ok) return;
    await submitProfile(() => router.refresh());
  }

  async function handleContinue() {
    setSaveError(null);
    if (!isLastTeacherStep(step, volunteerWizard)) {
      const ok = await validateStep(step);
      if (!ok) return;
      setStep((s) => nextTeacherStep(s, volunteerWizard));
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
      {saveError ? (
        <div
          id={SAVE_ERROR_ID}
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="min-w-0 flex-1">{saveError}</p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto shrink-0 p-1 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setSaveError(null)}
            aria-label="Dismiss this message"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      ) : null}
      {/*
        `waitForSubmit={false}` because the wizard's Continue button is a plain
        button, not a submit — RHF never records a submit, so the default gate
        would hide this however many fields are marked. Step names and jumps are
        wizard-only: in the flat edit view every field is already on screen, and
        naming a step the reader cannot see would be worse than saying nothing.
      */}
      <FormErrorSummary
        title="These fields need your attention:"
        waitForSubmit={false}
        fieldLabels={FIELD_LABELS}
        sectionOf={
          isEdit
            ? undefined
            : (field) => {
                const index = stepOfField(field as keyof TeacherFormValues);
                return index >= 0 ? TEACHER_STEPS[index]?.shortLabel : undefined;
              }
        }
        onJump={
          isEdit
            ? undefined
            : (field) => {
                const index = stepOfField(field as keyof TeacherFormValues);
                if (index >= 0) setStep(index);
              }
        }
      />
      {isEdit || step === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {isEdit ? "Account" : `${stepNumeral(0)}. Respondent Information`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <FormTextField
                control={form.control}
                name="firstName"
                label="First name"
                required
                maxLength={100}
                autoComplete="given-name"
                autoCapitalize="words"
              />
              <FormTextField
                control={form.control}
                name="middleName"
                label="Middle name"
                maxLength={100}
                autoComplete="additional-name"
                autoCapitalize="words"
                description="Optional"
              />
              <FormTextField
                control={form.control}
                name="lastName"
                label="Last name"
                required
                maxLength={100}
                autoComplete="family-name"
                autoCapitalize="words"
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
            <div className="space-y-3 md:max-w-sm">
              <FormSelectField
                control={form.control}
                name="ethnicity"
                label="Ethnicity"
                description="Optional."
                options={toOptions(ETHNICITY_LABELS)}
                allowEmpty
                emptyLabel="Not specified"
                onValueChange={changeEthnicity}
              />
              {ethnicity === "OTHER" ? (
                <FormTextField
                  control={form.control}
                  name="ethnicityOther"
                  label="Please specify"
                  required
                  maxLength={80}
                />
              ) : null}
              {ethnicity && !showSecondEthnicity ? (
                <button
                  type="button"
                  onClick={() => setShowSecondEthnicity(true)}
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  + Add another ethnicity
                </button>
              ) : null}
              {ethnicity && showSecondEthnicity ? (
                <div className="space-y-3">
                  <FormSelectField
                    control={form.control}
                    name="secondaryEthnicity"
                    label="Second ethnicity"
                    description="Optional."
                    options={secondEthnicityOptions}
                    allowEmpty
                    emptyLabel="Not specified"
                  />
                  {secondaryEthnicity === "OTHER" ? (
                    <FormTextField
                      control={form.control}
                      name="secondaryEthnicityOther"
                      label="Please specify"
                      required
                      maxLength={80}
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={removeSecondEthnicity}
                    className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline"
                  >
                    Remove second ethnicity
                  </button>
                </div>
              ) : null}
            </div>
            {volunteerWizard ? (
              /*
                Locked, not hidden: the person has to see what they registered
                as, and read the one line telling them where to change it. The
                value itself is already in form state (seeded by the page from
                `User.registeredAsAralVolunteer`), so nothing is submitted from
                this block — it only renders that state.
              */
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Designation</p>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <span className="text-sm font-medium">{ARAL_VOLUNTEER_DESIGNATION}</span>
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  <span className="sr-only">This field cannot be changed here.</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  From the box you ticked when you created this account. If that was a
                  mistake, change it later under Settings → Profile.
                </p>
              </div>
            ) : (
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
                    if (!yearsInServiceTouchedRef.current && !form.getValues("yearsInService")) {
                      form.setValue("yearsInServiceApplicable", false);
                    }
                  }
                }
              }}
            />
            )}
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
              {isEdit ? "Professional background" : `${stepNumeral(1)}. Professional Background`}
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
              {isEdit ? "Teaching assignment" : `${stepNumeral(2)}. Teaching Assignment`}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {noAssignableSections ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {gradeLevels.length === 0
                  ? "Your school has no grade levels set up yet. Ask your School Head to add grade levels and sections before you can finish profiling."
                  : "Every section in your school already has an adviser. Ask your School Head to add a section for you before you can finish profiling."}
              </div>
            ) : null}
            <FormSelectField
              control={form.control}
              name="currentGradeAssignment"
              label="Current Grade Level / Assignment"
              description={
                assignmentRequired
                  ? "The grade you're assigned to. Fully-booked grades are disabled unless you don't need a classroom section."
                  : "Optional for the ARAL Volunteer designation — you aren't attached to a grade level."
              }
              required={assignmentRequired}
              allowEmpty={!assignmentRequired}
              emptyLabel="N/A — no grade assignment"
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
                assignmentRequired
                  ? "The classroom section you'll advise. Sections already taken by another teacher are disabled."
                  : "Optional for the ARAL Volunteer designation — you don't advise a classroom section."
              }
              required={assignmentRequired}
              allowEmpty={!assignmentRequired}
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
              {isEdit ? "Training" : `${stepNumeral(3)}. Training & Professional Development`}
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
            <CardTitle className="text-base">{stepNumeral(4)}. Review & Submit</CardTitle>
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
                  "Ethnicity",
                  formatEthnicities(
                    values.ethnicity,
                    values.ethnicityOther,
                    values.secondaryEthnicity,
                    values.secondaryEthnicityOther
                  ),
                ],
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
            {/* No step to review, and its Edit button would jump to a step the
                volunteer's Continue walk skips. */}
            {volunteerWizard ? null : (
            <ReviewBlock
              title="Teaching Assignment"
              onEdit={() => setStep(2)}
              rows={[
                [
                  "Grade assignment",
                  // "N/A" rather than labelOf's "—": for a volunteer this is a
                  // deliberate choice, not a value they forgot to fill in.
                  values.currentGradeAssignment
                    ? labelOf(GRADE_LEVEL_LABELS, values.currentGradeAssignment)
                    : "N/A",
                ],
                [
                  "Section",
                  selectedSectionName ?? "N/A",
                ],
              ]}
            />
            )}
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
          steps={wizardSteps}
          currentStep={visiblePositionOf(step, volunteerWizard)}
          pending={pending}
          onBack={() => setStep((s) => previousTeacherStep(s, volunteerWizard))}
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
