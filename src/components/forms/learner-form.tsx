"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FieldRadioGroup, FieldCheckboxList } from "./profile-shared";
import {
  FormProgressBar,
  FormSections,
  formProgress,
  sectionKeyOf,
  snapshotForm,
  type FormSectionDef,
  type FormValues,
  type RenderedFormSection,
} from "./form-sections";
import {
  FRUSTRATION_SUBTYPE_LABELS,
  GRADE_LEVEL_LABELS,
  PARENT_EDUCATION_LABELS,
  TRANSPORTATION_LABELS,
  DISTANCE_LABELS,
  TRANSFER_LABELS,
  ETHNICITY_LABELS,
  NUTRITIONAL_STATUS_LABELS,
  isEarlyGradeReadingBand,
  readingProfileLabelsForGradeType,
  toOptions,
} from "@/lib/constants/enum-labels";
import { createLearner, updateLearner } from "@/lib/actions/learner";
import { invalidateNavWarm } from "@/components/nav-prefetcher";
import type { AdvisoryPlacement } from "@/lib/teachers/advisory";

/*
 * The learner form, in four collapsible sections with a completion bar.
 *
 * Both of its hosts are dialogs — the Add learner dialog, and the Student
 * Profile dialog's edit mode — so the form owns the whole body: it lays itself
 * out as a flex column with a scrolling section list and a pinned footer, and
 * expects a height-constrained flex parent. That also keeps the submit button
 * singular; a dialog footer rendering its own would need `form=` plumbing back
 * into here.
 */

/**
 * Where the learner sits.
 *
 * Add mode with one advisory: shown, never chosen — the teacher's only section is
 * the only place a new learner can go. Add mode with several advisories: a
 * required picker over exactly those sections, so the choice can never land
 * outside them. Edit mode: the learner's current placement, always shown as a
 * line of text — moving a learner between sections is the School Head's transfer
 * flow, not a side effect of correcting a spelling.
 *
 * The free-form grade selects this replaces were the bug: the grade list was
 * built from every grade the teacher touched (advisory *and* ARAL designations)
 * while the server accepted only the advisory one, so a teacher who also tutored
 * ARAL learners was offered a grade the save then refused.
 */
export type LearnerFormPlacement = {
  gradeLabel: string;
  sectionName: string | null;
};

export type LearnerFormDefaults = {
  id?: string;
  firstName?: string;
  middleName?: string | null;
  lastName?: string;
  age?: number;
  gender?: string;
  nutritionalStatus?: string | null;
  ethnicity?: string | null;
  ethnicityOther?: string | null;
  secondaryEthnicity?: string | null;
  secondaryEthnicityOther?: string | null;
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
};

type LearnerFormProps = {
  /**
   * The grade the learner belongs to. Submitted so the server can reject a stale
   * client, not chosen here — see {@link LearnerFormPlacement}. Edit mode always
   * passes this; create mode passes it only alongside a single-item
   * {@link LearnerFormProps.placements} (or omits `placements` altogether).
   */
  gradeLevelId?: string;
  /** Drives the reading-band labels, which differ for the early grades. */
  gradeType?: string;
  /**
   * The placement line. Without it the header falls back to the grade type's
   * label, which is all a caller that cannot name the section has to show.
   */
  placement?: LearnerFormPlacement;
  /**
   * Create mode only: every section the teacher advises. One entry reproduces
   * the old static line (and still posts its `sectionId`); more than one swaps
   * the line for a required "Grade & section" picker limited to exactly these
   * sections, and `gradeLevelId`/`gradeType`/`placement` above are ignored in
   * favor of whichever placement is chosen.
   */
  placements?: AdvisoryPlacement[];
  mode?: "create" | "edit";
  defaultValues?: LearnerFormDefaults;
  submitLabel?: string;
  /** Fired on successful create, so the host can close before the refresh. */
  onCreated?: () => void;
  /**
   * Fired on successful edit. The host decides what happens next — the profile
   * dialog re-reads the row in place rather than navigating away from itself.
   */
  onSaved?: () => void;
  /** Draws a Cancel button beside submit, for a host that can be dismissed. */
  onCancel?: () => void;
};

const FRUSTRATION = "FRUSTRATION_HIGH_EMERGENT";

/**
 * The four groups the DepEd form divides into, and what each owes the server.
 *
 * Kept at module scope and exported so the completion arithmetic can be unit
 * tested without rendering, and so the required-field lists sit together where
 * they can be read against the schema they mirror
 * (`src/lib/validators/learner.schema.ts`) instead of scattered through JSX.
 *
 * `gradeLevelId` is required by the schema but deliberately absent here: it is no
 * longer a field the teacher fills in — placement is derived from their advisory
 * section and merely displayed — so counting it would park the bar above zero on
 * an untouched form.
 */
export const LEARNER_FORM_SECTIONS: readonly FormSectionDef[] = [
  {
    key: "identity",
    title: "Identity & placement",
    hint: "Name, age, gender, nutritional status, and where this learner sits",
    requiredFields: (values: FormValues) => {
      const fields = ["firstName", "lastName", "age", "gender", "nutritionalStatus"];
      // Choosing Others mounts a field that then has to be filled, in either
      // slot, so the progress bar has to count it the moment it appears.
      if (values.ethnicity === "OTHER") fields.push("ethnicityOther");
      if (values.secondaryEthnicity === "OTHER") fields.push("secondaryEthnicityOther");
      return fields;
    },
  },
  {
    key: "reading",
    title: "Reading levels",
    hint: "English and Filipino bands from the latest assessment",
    requiredFields: () => ["englishReadingProfile", "filipinoReadingProfile"],
  },
  {
    key: "household",
    title: "Household & support",
    hint: "4Ps status and the parents' educational background",
    requiredFields: () => ["parentEducation"],
  },
  {
    key: "background",
    title: "Attendance & school background",
    hint: "Section B of the DepEd form — fill in what you know",
    // Nothing here is required until Multiple transfers is chosen, which is why
    // this section reads Optional rather than carrying a tick.
    requiredFields: (values: FormValues) =>
      values.previousTransfers === "MULTIPLE" ? ["transferDetails"] : [],
  },
];

export function LearnerForm({
  gradeLevelId,
  gradeType,
  placement,
  placements,
  mode = "create",
  defaultValues,
  submitLabel,
  onCreated,
  onSaved,
  onCancel,
}: LearnerFormProps) {
  const [pending, startTransition] = useTransition();
  const [duplicatePending, setDuplicatePending] = useState(false);
  const [englishProfile, setEnglishProfile] = useState(defaultValues?.englishReadingProfile ?? "");
  const [filipinoProfile, setFilipinoProfile] = useState(
    defaultValues?.filipinoReadingProfile ?? ""
  );
  const [previousTransfers, setPreviousTransfers] = useState(
    defaultValues?.previousTransfers ?? ""
  );
  const [ethnicity, setEthnicity] = useState(defaultValues?.ethnicity ?? "");
  // Held in state, not left to `defaultValue`: the field only exists while Others
  // is selected, so an uncontrolled input lost whatever was typed the moment the
  // teacher looked at another ethnicity and came back.
  const [ethnicityOther, setEthnicityOther] = useState(
    defaultValues?.ethnicityOther ?? ""
  );
  // A second ethnicity, for a learner of mixed heritage. Hidden behind a button
  // rather than shown as an empty select, so the common single answer stays a
  // one-line question. An edit of a learner who has two opens with it showing.
  const [showSecondEthnicity, setShowSecondEthnicity] = useState(
    Boolean(defaultValues?.secondaryEthnicity)
  );
  const [secondaryEthnicity, setSecondaryEthnicity] = useState(
    defaultValues?.secondaryEthnicity ?? ""
  );
  const [secondaryEthnicityOther, setSecondaryEthnicityOther] = useState(
    defaultValues?.secondaryEthnicityOther ?? ""
  );

  /** Clearing the first answer takes the second with it — it cannot stand alone. */
  function changeEthnicity(next: string) {
    setEthnicity(next);
    if (next === "") {
      setShowSecondEthnicity(false);
      setSecondaryEthnicity("");
      setSecondaryEthnicityOther("");
      return;
    }
    // The second may not repeat the first, so a collision clears the second
    // rather than letting the server reject the save.
    if (next !== "OTHER" && next === secondaryEthnicity) {
      setSecondaryEthnicity("");
      setSecondaryEthnicityOther("");
    }
  }

  function removeSecondEthnicity() {
    setShowSecondEthnicity(false);
    setSecondaryEthnicity("");
    setSecondaryEthnicityOther("");
  }
  const [values, setValues] = useState<FormValues>({});
  const [openSection, setOpenSection] = useState(LEARNER_FORM_SECTIONS[0].key);
  const formRef = useRef<HTMLFormElement | null>(null);
  const router = useRouter();
  const isEdit = mode === "edit";
  const label = submitLabel ?? (isEdit ? "Save changes" : "Add learner");
  const idPrefix = isEdit ? "learner-edit" : "learner-add";

  // Edit mode never picks a placement — `placements` is a create-mode-only prop.
  const advisoryPlacements = isEdit ? [] : placements ?? [];
  const singlePlacement =
    advisoryPlacements.length === 1 ? advisoryPlacements[0] : undefined;
  const isMultiAdvisory = advisoryPlacements.length > 1;

  const [selectedSectionId, setSelectedSectionId] = useState("");
  const [sectionError, setSectionError] = useState(false);
  const chosenPlacement = isMultiAdvisory
    ? advisoryPlacements.find((p) => p.sectionId === selectedSectionId)
    : undefined;

  const effectiveGradeLevelId =
    singlePlacement?.gradeLevelId ?? chosenPlacement?.gradeLevelId ?? gradeLevelId;
  const effectiveSectionId = singlePlacement?.sectionId ?? chosenPlacement?.sectionId;
  const selectedGradeType =
    singlePlacement?.gradeType ?? chosenPlacement?.gradeType ?? gradeType;
  // Memoized because it is a fresh object literal on every render, and
  // `gradeLabel` below depends on it — without this the label's useMemo would
  // recompute on every keystroke in the form.
  const activePlacement = singlePlacement ?? chosenPlacement;
  const displayPlacement: LearnerFormPlacement | undefined = useMemo(
    () =>
      activePlacement
        ? {
            gradeLabel: activePlacement.gradeLabel,
            sectionName: activePlacement.sectionName,
          }
        : placement,
    [activePlacement, placement]
  );

  const readingProfileOptions = useMemo(
    () => toOptions(readingProfileLabelsForGradeType(selectedGradeType)),
    [selectedGradeType]
  );

  const frustrationHint = selectedGradeType && isEarlyGradeReadingBand(selectedGradeType)
    ? "If high emergent:"
    : "If frustration:";

  const gradeLabel = useMemo(() => {
    if (displayPlacement?.gradeLabel) return displayPlacement.gradeLabel;
    if (selectedGradeType) {
      return GRADE_LEVEL_LABELS[selectedGradeType] ?? selectedGradeType;
    }
    return "—";
  }, [displayPlacement, selectedGradeType]);

  const refreshValues = useCallback(() => {
    const form = formRef.current;
    if (form) setValues(snapshotForm(form));
  }, []);

  // Re-read on mount so an edit's prefilled row shows its ticks on the first
  // frame, and again whenever a control appears or disappears — choosing Others
  // mounts a newly required field, which typing-driven `onInput` cannot see.
  useEffect(() => {
    refreshValues();
  }, [
    refreshValues,
    ethnicity,
    secondaryEthnicity,
    showSecondEthnicity,
    previousTransfers,
    englishProfile,
    filipinoProfile,
  ]);

  const progress = formProgress(LEARNER_FORM_SECTIONS, values);

  /**
   * A control inside a collapsed section is not focusable, so the browser
   * refuses the submit and reports nothing the teacher can see. Click fires
   * before constraint validation, so catch it here: find the first failing
   * control, open the section holding it, then let the browser say its piece now
   * that the field is on screen.
   */
  function handleSubmitClick(event: MouseEvent<HTMLButtonElement>) {
    const form = formRef.current;
    if (!form) return;
    refreshValues();

    // The picker is a Radix trigger, not a native form control, so constraint
    // validation below never sees it — check it first, in the same "open the
    // section, then focus" shape the native checks use below.
    if (isMultiAdvisory && !selectedSectionId) {
      event.preventDefault();
      setSectionError(true);
      setOpenSection(LEARNER_FORM_SECTIONS[0].key);
      requestAnimationFrame(() => {
        document.getElementById(`${idPrefix}-section-picker`)?.focus();
      });
      return;
    }

    const invalid = Array.from(form.elements).find(
      (el) =>
        typeof (el as HTMLInputElement).checkValidity === "function" &&
        !(el as HTMLInputElement).checkValidity()
    ) as HTMLElement | undefined;
    if (!invalid) return;

    event.preventDefault();
    const key = sectionKeyOf(invalid);
    if (key) setOpenSection(key);
    requestAnimationFrame(() => {
      invalid.focus();
      form.reportValidity();
    });
  }

  /**
   * `onSubmit`, not `<form action>`. React 19 resets a form after every action
   * it runs — failures included — which wiped everything typed whenever the
   * server refused a save or warned of a duplicate. The controlled selects kept
   * their state while the DOM snapped back to "Not specified", so "Create
   * anyway" posted an empty ethnicity the teacher never chose. The success path
   * clears the form itself below; nothing else should.
   */
  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    handleSubmit(new FormData(event.currentTarget));
  }

  function handleSubmit(fd: FormData) {
    // Sent so the server can reject a stale client rather than silently rerouting
    // the learner; the placement itself is derived server-side from the advisory.
    // `handleSubmitClick` refuses to reach here with an unset picker, so this is
    // always defined by the time a create-mode submit lands.
    if (effectiveGradeLevelId) fd.set("gradeLevelId", effectiveGradeLevelId);
    // Explicit even for a single advisory — harmless, and it means the server
    // never has to special-case "no section named" from "only one to choose".
    if (effectiveSectionId) fd.set("sectionId", effectiveSectionId);
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
    // Only send free-text ethnicity when Others is selected (server refine enforces).
    if (ethnicity !== "OTHER") {
      fd.delete("ethnicityOther");
    }
    if (secondaryEthnicity !== "OTHER") {
      fd.delete("secondaryEthnicityOther");
    }

    startTransition(async () => {
      if (isEdit) {
        const res = await updateLearner(fd);
        if (res.ok) {
          toast.success("Learner updated");
          onSaved?.();
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
        // Close host / clear form immediately; list refreshes in background.
        onCreated?.();
        toast.success("Learner added", { id: toastId });
        setDuplicatePending(false);
        formRef.current?.reset();
        setEnglishProfile("");
        setFilipinoProfile("");
        setPreviousTransfers("");
        setEthnicity("");
        setEthnicityOther("");
        setSelectedSectionId("");
        setSectionError(false);
        removeSecondEthnicity();
        setOpenSection(LEARNER_FORM_SECTIONS[0].key);
        refreshValues();
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

  const content: Record<string, ReactNode> = {
    identity: (
      <>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="firstName">First name *</Label>
            <Input
              id="firstName"
              name="firstName"
              required
              maxLength={80}
              autoComplete="given-name"
              autoCapitalize="words"
              defaultValue={defaultValues?.firstName ?? ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="middleName">Middle name</Label>
            <Input
              id="middleName"
              name="middleName"
              maxLength={80}
              autoComplete="additional-name"
              autoCapitalize="words"
              defaultValue={defaultValues?.middleName ?? ""}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lastName">Last name *</Label>
            <Input
              id="lastName"
              name="lastName"
              required
              maxLength={80}
              autoComplete="family-name"
              autoCapitalize="words"
              defaultValue={defaultValues?.lastName ?? ""}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
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
          <p className="text-sm font-medium">Nutritional Status *</p>
          <FieldRadioGroup
            name="nutritionalStatus"
            options={toOptions(NUTRITIONAL_STATUS_LABELS)}
            defaultValue={defaultValues?.nutritionalStatus ?? undefined}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="ethnicity">Ethnicity (optional)</Label>
          <select
            id="ethnicity"
            name="ethnicity"
            value={ethnicity}
            onChange={(e) => changeEthnicity(e.target.value)}
            className="flex h-11 w-full rounded-lg border border-input bg-card px-3 text-sm sm:h-10"
          >
            <option value="">Not specified</option>
            {toOptions(ETHNICITY_LABELS).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {ethnicity === "OTHER" ? (
            <div className="mt-3 space-y-1">
              <Label htmlFor="ethnicityOther">Please specify *</Label>
              <Input
                id="ethnicityOther"
                name="ethnicityOther"
                required
                maxLength={80}
                value={ethnicityOther}
                onChange={(e) => setEthnicityOther(e.target.value)}
              />
            </div>
          ) : null}

          {ethnicity && !showSecondEthnicity ? (
            <Button
              type="button"
              variant="link"
              onClick={() => setShowSecondEthnicity(true)}
              className="mt-2 h-auto p-0"
            >
              + Add another ethnicity
            </Button>
          ) : null}

          {ethnicity && showSecondEthnicity ? (
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="secondaryEthnicity">Second ethnicity (optional)</Label>
                <Button
                  type="button"
                  variant="link"
                  onClick={removeSecondEthnicity}
                  className="h-auto p-0 text-xs text-muted-foreground"
                >
                  Remove
                </Button>
              </div>
              <select
                id="secondaryEthnicity"
                name="secondaryEthnicity"
                value={secondaryEthnicity}
                onChange={(e) => setSecondaryEthnicity(e.target.value)}
                className="flex h-11 w-full rounded-lg border border-input bg-card px-3 text-sm sm:h-10"
              >
                <option value="">Not specified</option>
                {toOptions(ETHNICITY_LABELS)
                  /*
                    The first answer is dropped from this list so the two can
                    never be the same. "Others" survives the filter: someone of
                    mixed heritage may have to write both halves in by hand.
                  */
                  .filter((o) => o.value !== ethnicity || o.value === "OTHER")
                  .map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
              </select>
              {secondaryEthnicity === "OTHER" ? (
                <div className="mt-3 space-y-1">
                  <Label htmlFor="secondaryEthnicityOther">Please specify *</Label>
                  <Input
                    id="secondaryEthnicityOther"
                    name="secondaryEthnicityOther"
                    required
                    maxLength={80}
                    value={secondaryEthnicityOther}
                    onChange={(e) => setSecondaryEthnicityOther(e.target.value)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {isEdit ? "Placement" : "Joining"}
          </p>
          {isMultiAdvisory ? (
            <div className="mt-2 space-y-1">
              <Label htmlFor={`${idPrefix}-section-picker`}>
                Grade & section *
              </Label>
              <Select
                value={selectedSectionId}
                onValueChange={(value) => {
                  setSelectedSectionId(value);
                  setSectionError(false);
                }}
              >
                <SelectTrigger
                  id={`${idPrefix}-section-picker`}
                  aria-invalid={sectionError}
                  aria-describedby={
                    sectionError ? `${idPrefix}-section-error` : undefined
                  }
                >
                  <SelectValue placeholder="Choose a grade & section" />
                </SelectTrigger>
                <SelectContent>
                  {advisoryPlacements.map((p) => (
                    <SelectItem key={p.sectionId} value={p.sectionId}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {sectionError ? (
                <p
                  id={`${idPrefix}-section-error`}
                  role="alert"
                  className="text-xs font-medium text-destructive"
                >
                  Choose which of your advisory sections this learner joins.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  You advise {advisoryPlacements.length} sections — pick where
                  this learner joins.
                </p>
              )}
            </div>
          ) : (
            <>
              <p className="mt-1 text-sm font-semibold text-foreground">
                {gradeLabel}
                {displayPlacement?.sectionName ? (
                  <>
                    <span className="px-1.5 font-normal text-muted-foreground">·</span>
                    {displayPlacement.sectionName}
                  </>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {isEdit
                  ? "Moving a learner between sections is a transfer — ask your School Head."
                  : "New learners join your advisory section."}
              </p>
            </>
          )}
        </div>
      </>
    ),

    reading: (
      <>
        <div>
          <p className="mb-2 text-sm font-medium">Reading Level (English) *</p>
          <FieldRadioGroup
            name="englishReadingProfile"
            options={readingProfileOptions}
            value={englishProfile}
            onValueChange={setEnglishProfile}
            defaultValue={defaultValues?.englishReadingProfile}
          />
          {englishProfile === FRUSTRATION ? (
            <div className="mt-2">
              <p className="mb-1 text-xs text-muted-foreground">{frustrationHint}</p>
              <FieldCheckboxList
                name="englishFrustrationSubtypes"
                options={toOptions(FRUSTRATION_SUBTYPE_LABELS)}
                defaultValues={defaultValues?.englishFrustrationSubtypes ?? []}
              />
            </div>
          ) : null}
        </div>

        <div className="border-t border-border/60 pt-4">
          <p className="mb-2 text-sm font-medium">Reading Level (Filipino) *</p>
          <FieldRadioGroup
            name="filipinoReadingProfile"
            options={readingProfileOptions}
            value={filipinoProfile}
            onValueChange={setFilipinoProfile}
            defaultValue={defaultValues?.filipinoReadingProfile}
          />
          {filipinoProfile === FRUSTRATION ? (
            <div className="mt-2">
              <p className="mb-1 text-xs text-muted-foreground">{frustrationHint}</p>
              <FieldCheckboxList
                name="filipinoFrustrationSubtypes"
                options={toOptions(FRUSTRATION_SUBTYPE_LABELS)}
                defaultValues={defaultValues?.filipinoFrustrationSubtypes ?? []}
              />
            </div>
          ) : null}
        </div>
      </>
    ),

    household: (
      <>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            name="governmentBenefits[]"
            value="FOUR_PS"
            defaultChecked={defaultValues?.governmentBenefits?.includes("FOUR_PS")}
            className="mt-0.5 h-4 w-4 accent-primary"
          />
          <span className="text-sm font-medium leading-tight">
            Is the student a 4Ps beneficiary?
          </span>
        </label>

        <div className="border-t border-border/60 pt-4">
          <p className="mb-2 text-sm font-medium">
            Parents&apos; Educational Background *
          </p>
          <FieldRadioGroup
            name="parentEducation"
            options={toOptions(PARENT_EDUCATION_LABELS)}
            defaultValue={defaultValues?.parentEducation}
          />
        </div>
      </>
    ),

    background: (
      <>
        <div>
          <p className="mb-2 text-sm font-medium">Mode of Transportation</p>
          <FieldRadioGroup
            name="modeOfTransportation"
            options={toOptions(TRANSPORTATION_LABELS)}
            defaultValue={defaultValues?.modeOfTransportation ?? undefined}
            required={false}
          />
        </div>
        <div className="border-t border-border/60 pt-4">
          <p className="mb-2 text-sm font-medium">Distance from Home to School</p>
          <FieldRadioGroup
            name="distanceHomeToSchool"
            options={toOptions(DISTANCE_LABELS)}
            defaultValue={defaultValues?.distanceHomeToSchool ?? undefined}
            required={false}
          />
        </div>
        <div className="border-t border-border/60 pt-4">
          <p className="mb-2 text-sm font-medium">Previous School Transfers</p>
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
      </>
    ),
  };

  const renderedSections: RenderedFormSection[] = LEARNER_FORM_SECTIONS.map(
    (section) => ({ ...section, content: content[section.key] })
  );

  return (
    <form
      ref={formRef}
      onSubmit={handleFormSubmit}
      // Each control is snapshotted on the event that is safe for it, because
      // no single event is safe for both.
      //
      // A <select> must NOT be snapshotted on `input`. A browser fires `input`
      // before `change`, so snapshotting there re-rendered the tree while the
      // select's own state was still stale — React re-applied the old controlled
      // `value`, wiping the pick, and the `change` handler then read back "".
      // That is why every ethnicity choice snapped to "Not specified". On
      // `change` the form rides the same native event as the control's own
      // handler, so both state updates land in one batch and nothing re-renders
      // in between.
      //
      // A text input must NOT wait for `change`, which only fires on blur — the
      // completion bar has to follow typing, which is what `input` gives it.
      //
      // Splitting them this way also keeps it at exactly one snapshot per
      // interaction rather than two.
      onInput={(e) => {
        if ((e.target as HTMLElement).tagName !== "SELECT") refreshValues();
      }}
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === "SELECT") refreshValues();
      }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
        {/* Add only. An existing row already satisfies every requirement, so a
            bar in edit mode would sit at 100% and mean nothing; the section
            ticks carry the same information there without the false progress. */}
        {isEdit ? null : (
          <FormProgressBar
            filled={progress.filled}
            total={progress.total}
            percent={progress.percent}
            label="Learner details"
          />
        )}

        <FormSections
          sections={renderedSections}
          values={values}
          openKey={openSection}
          onOpenKeyChange={setOpenSection}
          idPrefix={idPrefix}
        />

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
      </div>

      <footer className="flex flex-col-reverse gap-2 border-t border-border bg-muted/30 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
        {onCancel ? (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
            className="justify-center"
          >
            Cancel
          </Button>
        ) : null}
        <Button
          type="submit"
          loading={pending}
          loadingText="Saving…"
          onClick={handleSubmitClick}
          className={onCancel ? "justify-center" : "w-full justify-center"}
        >
          {duplicatePending && !isEdit ? "Create anyway" : label}
        </Button>
      </footer>
    </form>
  );
}
