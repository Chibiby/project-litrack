import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Test Lab dry run (docs/test-lab-spec.md T6): the teacher profile form shows
 * the amber notice, and a dry-run success opens a preview dialog instead of
 * redirecting or toasting "saved". Outside a Test Lab session, nothing here
 * changes — that is pinned by the "no dryRun prop" cases.
 */

beforeAll(() => {
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/settings/profile",
  useSearchParams: () => new URLSearchParams(""),
}));

const saveTeacherProfile = vi.fn();
vi.mock("@/lib/actions/teacher", async () => {
  const actual = await vi.importActual<typeof import("@/lib/actions/teacher")>(
    "@/lib/actions/teacher",
  );
  return {
    ...actual,
    saveTeacherProfile: (...args: unknown[]) => saveTeacherProfile(...(args as [])),
  };
});

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...(args as [])),
    error: (...args: unknown[]) => toastError(...(args as [])),
  },
}));

const { TeacherProfileForm } = await import("@/components/forms/teacher-profile-form");

const GRADE_LEVELS = [
  {
    id: "grade-g3",
    type: "G3",
    sections: [{ id: "11111111-1111-4111-8111-111111111111", name: "Sampaguita", takenByOther: false }],
  },
];

const COMPLETE = {
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

const DRY_RUN_RESULT = {
  ok: true as const,
  data: {
    dryRun: true as const,
    preview: {
      firstName: "Juan",
      middleName: null,
      lastName: "Dela Cruz",
      fullName: "Juan Dela Cruz",
      designation: "Teacher",
      advisoryMode: "DEFAULT" as const,
      sectionId: "11111111-1111-4111-8111-111111111111",
      additionalSectionIds: [],
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("teacher profiling — Test Lab dry run", () => {
  it("shows the amber notice when dryRun is set", () => {
    render(
      <TeacherProfileForm
        presentation="edit"
        defaultValues={COMPLETE}
        gradeLevels={GRADE_LEVELS}
        dryRun
      />,
    );

    expect(screen.getByText("Test Lab")).toBeTruthy();
    expect(
      screen.getByText(/Nothing on this form will be saved/),
    ).toBeTruthy();
  });

  it("does not show the notice outside a Test Lab session", () => {
    render(
      <TeacherProfileForm
        presentation="edit"
        defaultValues={COMPLETE}
        gradeLevels={GRADE_LEVELS}
      />,
    );

    expect(screen.queryByText("Test Lab")).toBeNull();
  });

  it("opens a preview dialog and never redirects or toasts 'saved' on a dry-run success", async () => {
    saveTeacherProfile.mockResolvedValue(DRY_RUN_RESULT);

    render(
      <TeacherProfileForm
        presentation="edit"
        defaultValues={COMPLETE}
        gradeLevels={GRADE_LEVELS}
        dryRun
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(saveTeacherProfile).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("Test Lab preview")).toBeTruthy());

    expect(screen.getByText("Juan Dela Cruz")).toBeTruthy();
    expect(screen.getByText("Sampaguita")).toBeTruthy();
    expect(toastSuccess).not.toHaveBeenCalledWith("Profile saved");
    expect(push).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("saves and redirects normally when the result carries no dryRun flag", async () => {
    saveTeacherProfile.mockResolvedValue({ ok: true });

    render(
      <TeacherProfileForm
        presentation="edit"
        defaultValues={COMPLETE}
        gradeLevels={GRADE_LEVELS}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(saveTeacherProfile).toHaveBeenCalled());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Profile saved"));
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByText("Test Lab preview")).toBeNull();
  });
});
