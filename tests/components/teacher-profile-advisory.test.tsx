import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

/**
 * Task 7: the profiling wizard stops locking a volunteer into a separate step
 * flow, and gives DepEd teachers the mutually exclusive `Floating teacher` /
 * `Multi-grade advisory` checkboxes that decide `advisoryMode` once, at
 * profiling. Edit mode (Settings) shows Designation and Teaching Assignment
 * read-only instead.
 */

beforeAll(() => {
  // Browser APIs the real form relies on and jsdom does not implement: Radix
  // probes pointer capture, its sizing hook constructs a ResizeObserver, and the
  // wizard scrolls the card back to the top on every step change.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.scrollTo = vi.fn();
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const push = vi.fn();
const refresh = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace, prefetch: vi.fn() }),
  usePathname: () => "/teacher/settings/profile",
  useSearchParams: () => new URLSearchParams(""),
}));

const saveTeacherProfile = vi.fn(async () => ({ ok: true }) as
  | { ok: true }
  | { ok: false; error: string });
vi.mock("@/lib/actions/teacher", () => ({
  saveTeacherProfile: (...args: unknown[]) => saveTeacherProfile(...(args as [])),
}));

vi.mock("@/lib/actions/auth", () => ({
  loginSchoolHead: vi.fn(),
  loginTeacher: vi.fn(),
  registerTeacher: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const formModule = await import("@/components/forms/teacher-profile-form");
const { TeacherProfileForm } = formModule;
const { LoginForm } = await import("@/components/forms/login-form");

const GRADE_LEVELS = [
  {
    id: "grade-g3",
    type: "G3",
    sections: [
      { id: "11111111-1111-4111-8111-111111111111", name: "Sampaguita", takenByOther: false },
      { id: "22222222-2222-4222-8222-222222222222", name: "Rosal", takenByOther: false },
      { id: "33333333-3333-4333-8333-333333333333", name: "Ilang-Ilang", takenByOther: false },
    ],
  },
];

/** A profile that clears every per-step check up through Training, so the
 * wizard reaches Teaching Assignment (step III) on Continue without stalling
 * on an earlier field. */
const BASE_DEFAULTS = {
  firstName: "Juan",
  lastName: "Dela Cruz",
  designation: "Teacher",
  position: "TEACHER_III",
  educationalAttainment: "BACHELORS",
  fieldOfSpecialization: "ENGLISH",
  yearsInService: 4,
  currentGradeAssignment: "G3",
  sectionId: "11111111-1111-4111-8111-111111111111",
  hasReadingTraining: true,
  readingTrainings: ["ARAL"],
  hasEnglishTraining: false,
  englishTrainings: [],
  highestTrainingLevel: "DIVISION",
};

/** Walk the wizard from step I (Respondent) to step III (Teaching Assignment). */
async function goToAssignmentStep() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByText("II. Professional Background")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByText("III. Teaching Assignment")).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  saveTeacherProfile.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("teacher profiling — advisory mode checkboxes", () => {
  it("keeps Floating teacher and Multi-grade advisory mutually exclusive", async () => {
    render(<TeacherProfileForm defaultValues={BASE_DEFAULTS} gradeLevels={GRADE_LEVELS} />);
    await goToAssignmentStep();

    const floating = () => screen.getByRole("checkbox", { name: "Floating teacher" });
    const multiGrade = () => screen.getByRole("checkbox", { name: "Multi-grade advisory" });

    fireEvent.click(floating());
    await waitFor(() => expect(floating().getAttribute("aria-checked")).toBe("true"));

    fireEvent.click(multiGrade());
    await waitFor(() => expect(multiGrade().getAttribute("aria-checked")).toBe("true"));
    // Checking Multi-grade after Floating leaves only Multi-grade checked.
    expect(floating().getAttribute("aria-checked")).toBe("false");
  });

  it("adds up to 2 extra section rows for Multi-grade advisory, then hides Add another section", async () => {
    render(<TeacherProfileForm defaultValues={BASE_DEFAULTS} gradeLevels={GRADE_LEVELS} />);
    await goToAssignmentStep();

    fireEvent.click(screen.getByRole("checkbox", { name: "Multi-grade advisory" }));

    const addButton = () => screen.getByRole("button", { name: "Add another section" });
    expect(addButton()).toBeTruthy();

    fireEvent.click(addButton());
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(1);
    expect(addButton()).toBeTruthy();

    fireEvent.click(addButton());
    // 3 rows total: the primary grade/section picker plus these 2 extras.
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Add another section" })).toBeNull();
  });

  it("removes the section pickers for the Non-DepEd ARAL Volunteer designation", async () => {
    render(<TeacherProfileForm defaultValues={BASE_DEFAULTS} gradeLevels={GRADE_LEVELS} />);

    fireEvent.click(screen.getByRole("button", { name: ARAL_VOLUNTEER_DESIGNATION }));
    await goToAssignmentStep();

    expect(
      screen.getByText(/Non-DepEd ARAL Volunteers don't take a teaching assignment/)
    ).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Floating teacher" })).toBeNull();
    expect(screen.queryByLabelText("Current Grade Level / Assignment")).toBeNull();
    expect(screen.queryByLabelText("Section")).toBeNull();
  });
});

describe("teacher profiling — edit mode", () => {
  it("renders Designation and Teaching Assignment read-only, no checkboxes", () => {
    render(
      <TeacherProfileForm
        presentation="edit"
        defaultValues={BASE_DEFAULTS}
        gradeLevels={GRADE_LEVELS}
      />
    );

    expect(screen.queryByRole("checkbox", { name: "Floating teacher" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Multi-grade advisory" })).toBeNull();
    expect(screen.getAllByText(/Ask your School Head to change this\./).length).toBeGreaterThan(0);
  });

  it("Ruling D: a DEFAULT teacher with no section can still save Settings (edit-mode uses the update schema)", async () => {
    render(
      <TeacherProfileForm
        presentation="edit"
        defaultValues={{
          ...BASE_DEFAULTS,
          currentGradeAssignment: undefined,
          sectionId: undefined,
        }}
        gradeLevels={GRADE_LEVELS}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(saveTeacherProfile).toHaveBeenCalledTimes(1));
    // Not blocked by "Select a section" / "Select a grade level" — the create
    // schema's DEFAULT-requires-a-section rule must not run in edit mode.
    expect(screen.queryByText("Select a section")).toBeNull();
    expect(screen.queryByText("Select a grade level")).toBeNull();
  });
});

describe("buildPayload — a designation change cannot leave a stale mode behind", () => {
  const { buildPayload } = formModule;
  const multiGrade = {
    firstName: "Juan", middleName: "", lastName: "Dela Cruz", contactNumber: "",
    ethnicity: undefined, ethnicityOther: "", secondaryEthnicity: undefined, secondaryEthnicityOther: "",
    designationKind: "Teacher" as const, designationOther: "", position: "TEACHER_III",
    educationalAttainment: "BACHELORS", fieldOfSpecialization: "ENGLISH", specializationOther: "",
    yearsInService: "4", yearsInServiceApplicable: true,
    currentGradeAssignment: "G3",
    sectionId: "11111111-1111-4111-8111-111111111111",
    advisoryMode: "MULTI_GRADE" as const,
    additionalSectionIds: ["22222222-2222-4222-8222-222222222222"],
    hasReadingTraining: false, readingTrainings: [], hasEnglishTraining: false, englishTrainings: [],
    highestTrainingLevel: "DIVISION",
  };

  it("keeps a Multi-grade teacher's extra sections", () => {
    const payload = buildPayload(multiGrade);
    expect(payload.advisoryMode).toBe("MULTI_GRADE");
    expect(payload.additionalSectionIds).toEqual(multiGrade.additionalSectionIds);
  });

  it("sends DEFAULT and no sections once the designation becomes Volunteer", () => {
    // The card hides the checkboxes and pickers for a volunteer but keeps their
    // values; sent as-is they fail validation on fields the volunteer cannot see.
    const payload = buildPayload({ ...multiGrade, designationKind: ARAL_VOLUNTEER_DESIGNATION });
    expect(payload.advisoryMode).toBe("DEFAULT");
    expect(payload.additionalSectionIds).toBeUndefined();
    expect(payload.sectionId).toBeUndefined();
    expect(payload.currentGradeAssignment).toBeUndefined();
  });
});

describe("sign-up — no ARAL volunteer checkbox", () => {
  it("does not offer a Non-DepEd ARAL Volunteer checkbox on the create-account tab", () => {
    render(
      <LoginForm
        schools={[{ id: "school-1", name: "Alabel Central ES", district: null, teachersOpen: true }]}
      />
    );

    fireEvent.click(screen.getByLabelText("School Name"));
    fireEvent.click(screen.getByText("Alabel Central ES"));
    fireEvent.click(screen.getByRole("button", { name: "Teachers" }));
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(screen.queryByLabelText(/Non-DepEd ARAL Volunteer/)).toBeNull();
  });
});
