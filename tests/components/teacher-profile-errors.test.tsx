import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the teacher is told when profiling refuses to go through.
 *
 * Two failures used to look the same from the outside — one opaque toast. A
 * missing field said "Invalid input" without naming the field or the step it
 * lives on, and a database that had not had its migrations applied said "Please
 * try again", which was untrue: that write is rejected forever. These tests pin
 * the two apart, because naming the field and being honest about retrying are
 * the whole point of the change.
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

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/settings/profile",
  useSearchParams: () => new URLSearchParams(""),
}));

const saveTeacherProfile = vi.fn(async () => ({ ok: true }) as
  | { ok: true }
  | { ok: false; error: string });
vi.mock("@/lib/actions/teacher", () => ({
  saveTeacherProfile: (...args: unknown[]) => saveTeacherProfile(...(args as [])),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...args: unknown[]) => toastError(...(args as [])) },
}));

const { TeacherProfileForm } = await import("@/components/forms/teacher-profile-form");

const GRADE_LEVELS = [
  {
    id: "grade-g3",
    type: "G3",
    sections: [{ id: "11111111-1111-4111-8111-111111111111", name: "Sampaguita", takenByOther: false }],
  },
];

/** A profile that clears every per-step check, so only the payload schema is left to fail. */
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

beforeEach(() => {
  vi.clearAllMocks();
  saveTeacherProfile.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("teacher profiling — unfilled fields", () => {
  it("names each unfilled field and the step it lives on", async () => {
    render(<TeacherProfileForm defaultValues={{}} gradeLevels={GRADE_LEVELS} />);

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("These fields need your attention:")).toBeTruthy();
    });

    // Named by their on-screen labels, not by field name and not by message alone.
    expect(
      screen.getByRole("button", { name: "First name — First name is required" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Last name — Last name is required" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Designation — Designation is required" }),
    ).toBeTruthy();

    // ...and each one says which step to look on.
    expect(screen.getAllByText("(Respondent)")).toHaveLength(3);

    // The count goes in the toast; the detail stays on the page where it persists.
    expect(toastError).not.toHaveBeenCalled();
  });

  it("says nothing until a submit is actually attempted", () => {
    render(<TeacherProfileForm defaultValues={{}} gradeLevels={GRADE_LEVELS} />);
    expect(screen.queryByText("These fields need your attention:")).toBeNull();
  });

  it("maps a payload-schema rejection back onto the field that caused it", async () => {
    // 'None at all' mixed with a real training passes every per-step check and is
    // only caught by the authoritative schema, whose issue arrives on a payload
    // key rather than a form field. Unmapped, the teacher got a bare toast and no
    // marked field; mapped, the offending control is named.
    render(
      <TeacherProfileForm
        presentation="edit"
        defaultValues={{ ...COMPLETE, readingTrainings: ["ARAL", "NONE"] }}
        gradeLevels={GRADE_LEVELS}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Recent reading trainings (last 5y) — 'None at all' cannot be combined with other reading trainings",
        }),
      ).toBeTruthy();
    });

    expect(toastError).toHaveBeenCalledWith("1 field needs your attention");
    // Rejected before the round trip — nothing was sent.
    expect(saveTeacherProfile).not.toHaveBeenCalled();
  });
});

describe("teacher profiling — the save itself fails", () => {
  it("keeps the server's reason on screen instead of flashing it in a toast", async () => {
    const reason =
      "Couldn't save your profile: this school's database is missing an update that this version of LITRACK needs. Trying again won't help — ask your administrator to finish the pending database update and give them this reference: DB-SCHEMA.";
    saveTeacherProfile.mockResolvedValue({ ok: false, error: reason });

    render(
      <TeacherProfileForm
        presentation="edit"
        defaultValues={COMPLETE}
        gradeLevels={GRADE_LEVELS}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() => expect(saveTeacherProfile).toHaveBeenCalled());
    // The reason a retry is pointless has to still be readable a minute later,
    // which a toast cannot promise.
    await waitFor(() => expect(screen.getByText(reason)).toBeTruthy());
    expect(screen.getByRole("button", { name: "Dismiss this message" })).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lets the teacher dismiss that message once they have read it", async () => {
    saveTeacherProfile.mockResolvedValue({ ok: false, error: "Invalid section selected." });

    render(
      <TeacherProfileForm
        presentation="edit"
        defaultValues={COMPLETE}
        gradeLevels={GRADE_LEVELS}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(screen.getByText("Invalid section selected.")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Dismiss this message" }));
    expect(screen.queryByText("Invalid section selected.")).toBeNull();
  });
});
