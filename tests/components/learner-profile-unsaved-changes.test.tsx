import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnerProfileData } from "@/lib/learners/profile";

/**
 * Edit mode of the Student Profile dialog: every exit from a dirty form asks
 * first, and the ARAL removal confirm states what stays and what is cleared.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/learners",
}));

const getLearnerProfile = vi.fn();
vi.mock("@/lib/actions/learner-profile", () => ({
  getLearnerProfile: (...args: unknown[]) => getLearnerProfile(...(args as [])),
}));

type StubFormProps = {
  onCancel?: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

// The real form reports dirtiness through `onDirtyChange`; the stub exposes it
// as a button so this file tests the dialog's reaction, not the form's fields.
vi.mock("@/components/forms/learner-form", () => ({
  LearnerForm: (props: StubFormProps) => (
    <div>
      <p>learner form stub</p>
      <button type="button" onClick={() => props.onDirtyChange?.(true)}>
        make dirty
      </button>
      <button type="button" onClick={() => props.onCancel?.()}>
        Cancel
      </button>
    </div>
  ),
}));

vi.mock("@/lib/actions/learner", () => ({
  toggleAralLearner: vi.fn(),
  enrollRosterLearnersToAral: vi.fn(),
}));
vi.mock("@/lib/actions/aral-tutors", () => ({ listAralTutorOptions: vi.fn() }));
vi.mock("@/components/nav-prefetcher", () => ({
  invalidateNavWarm: vi.fn(),
  NavPrefetcher: () => null,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), loading: () => "toast-1" },
}));

const { LearnerProfileModal } = await import("@/components/learners/learner-profile-modal");

function makeLearner(overrides: Partial<LearnerProfileData> = {}): LearnerProfileData {
  return {
    id: "learner-1",
    fullName: "Ana Santos",
    firstName: "Ana",
    middleName: "Reyes",
    lastName: "Santos",
    age: 10,
    gender: "FEMALE",
    nutritionalStatus: "NORMAL",
    ethnicity: null,
    ethnicityOther: null,
    secondaryEthnicity: null,
    secondaryEthnicityOther: null,
    englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
    englishFrustrationSubtypes: [],
    filipinoFrustrationSubtypes: [],
    governmentBenefits: [],
    parentEducation: "COLLEGE_GRADUATE",
    modeOfTransportation: null,
    distanceHomeToSchool: null,
    previousTransfers: null,
    transferDetails: null,
    gradeLevelId: "grade-g3",
    gradeType: "G3",
    sectionName: "Sampaguita",
    adviserName: "Teacher One",
    isAralLearner: false,
    aralEnrolledAt: null,
    aralTutorName: null,
    aralTeacherId: null,
    archivedAt: null,
    createdAt: "2026-06-10",
    enrollments: [],
    attendances: [],
    readingLevels: [],
    aralProfile: null,
    ...overrides,
  };
}

async function openEdit(onClose = vi.fn()) {
  render(<LearnerProfileModal learnerId="learner-1" onClose={onClose} isSuperAdmin={false} />);
  await screen.findByText("Ana Santos");
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  await screen.findByText("learner form stub");
  return onClose;
}

beforeEach(() => {
  vi.clearAllMocks();
  getLearnerProfile.mockResolvedValue({ ok: true, data: makeLearner() });
});
afterEach(cleanup);

describe("Student Profile dialog — unsaved edits", () => {
  it("returns to the profile without a question while nothing changed", async () => {
    await openEdit();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("tab", { name: "Profile" })).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  }, 15_000);

  it("asks before Cancel throws edits away; Keep editing stays in the form", async () => {
    await openEdit();
    fireEvent.click(screen.getByRole("button", { name: "make dirty" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    const alert = await screen.findByRole("alertdialog");
    expect(within(alert).getByText("Discard changes?")).toBeTruthy();
    fireEvent.click(within(alert).getByRole("button", { name: "Keep editing" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText("learner form stub")).toBeTruthy();
  }, 15_000);

  it("leaves edit mode once Discard changes is chosen", async () => {
    await openEdit();
    fireEvent.click(screen.getByRole("button", { name: "make dirty" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Discard changes" }));

    expect(await screen.findByRole("tab", { name: "Profile" })).toBeTruthy();
    expect(screen.queryByText("learner form stub")).toBeNull();
  }, 15_000);

  it("asks before Escape closes the whole dialog on a dirty form", async () => {
    const onClose = await openEdit();
    fireEvent.click(screen.getByRole("button", { name: "make dirty" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    const alert = await screen.findByRole("alertdialog");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(within(alert).getByRole("button", { name: "Discard changes" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  }, 15_000);
});

describe("Student Profile dialog — Remove from ARAL wording", () => {
  it("says what is kept, what is cleared, and that a tutor must be assigned again", async () => {
    getLearnerProfile.mockResolvedValue({
      ok: true,
      data: makeLearner({ isAralLearner: true, aralEnrolledAt: "2026-07-01", aralTeacherId: "t-1" }),
    });
    render(<LearnerProfileModal learnerId="learner-1" onClose={vi.fn()} isSuperAdmin={false} />);
    await screen.findByText("Ana Santos");
    fireEvent.click(screen.getByRole("button", { name: "Remove from ARAL" }));

    const alert = await screen.findByRole("alertdialog");
    const text = alert.textContent ?? "";
    expect(text).toContain("Attendance, reading levels, the ARAL profile and MOSY decisions are kept");
    expect(text).toContain("assigned ARAL tutor is cleared");
    expect(text).toContain("mark them as ARAL again later");
    expect(text).toContain("tutor has to be assigned again");
  }, 15_000);
});
