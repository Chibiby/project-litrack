import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveTeacherRow } from "@/components/teachers-active-table";
import type { AdvisorySettingResult } from "@/lib/actions/teacher";

/**
 * The School Head's "Edit role" dialog: the two-step confirm-release round
 * trip, the designation picker (including an unrecognized designation
 * prefilling Others), and the advisory radios hiding for a Volunteer.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/school-head/teachers",
  useSearchParams: () => new URLSearchParams(""),
}));

const setTeacherAdvisorySetting =
  vi.fn<(fd: FormData) => Promise<AdvisorySettingResult>>();
vi.mock("@/lib/actions/teacher", () => ({
  setTeacherAdvisorySetting: (fd: FormData) => setTeacherAdvisorySetting(fd),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { TeacherRoleDialog } = await import(
  "@/components/school-head/teacher-role-dialog"
);

const ROW: ActiveTeacherRow = {
  id: "teacher-1",
  fullName: "Marivic Cruz",
  email: "marivic@example.test",
  profileCompleted: true,
  approvedAt: "2026-06-01T00:00:00.000Z",
  learnerCount: 20,
  aralLearnerCount: 2,
  designation: "Teacher",
  advisoryMode: "DEFAULT",
  assignments: [{ sectionId: "sec-1", gradeName: "Grade 4", sectionName: "Sampaguita" }],
};

function formValues(fd: FormData) {
  return Object.fromEntries(fd.entries());
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("TeacherRoleDialog — confirm-release round trip", () => {
  it("shows the named releases and 'Unassign and save', then resubmits with confirmRelease=true", async () => {
    setTeacherAdvisorySetting.mockResolvedValueOnce({
      ok: false,
      error: "confirm_release",
      releases: [
        { id: "sec-1", label: "Grade 4 · Sampaguita" },
        { id: "sec-2", label: "Grade 4 · Rosal" },
      ],
    });
    setTeacherAdvisorySetting.mockResolvedValueOnce({ ok: true });

    render(<TeacherRoleDialog row={ROW} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit role" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await screen.findByRole("button", { name: "Unassign and save" });
    expect(screen.getByText("Grade 4 · Sampaguita")).toBeTruthy();
    expect(screen.getByText("Grade 4 · Rosal")).toBeTruthy();
    expect(
      screen.getByText("Their learners stay in the section and will need a new adviser.")
    ).toBeTruthy();

    // The first submit must never have carried confirmRelease.
    expect(setTeacherAdvisorySetting).toHaveBeenCalledTimes(1);
    expect(formValues(setTeacherAdvisorySetting.mock.calls[0][0]).confirmRelease).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: "Unassign and save" }));

    await waitFor(() => expect(setTeacherAdvisorySetting).toHaveBeenCalledTimes(2));
    expect(formValues(setTeacherAdvisorySetting.mock.calls[1][0]).confirmRelease).toBe("true");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("TeacherRoleDialog — designation and advisory setting", () => {
  it("hides the advisory radios when Volunteer is chosen", async () => {
    render(<TeacherRoleDialog row={ROW} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit role" }));
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("Advisory setting")).toBeTruthy();

    fireEvent.change(within(dialog).getByRole("combobox"), {
      target: { value: "Non-DepEd ARAL Volunteer" },
    });

    expect(within(dialog).queryByText("Advisory setting")).toBeNull();
  });

  it("sends DEFAULT for a Volunteer even when the row was Multi-grade", async () => {
    // The radios hide for a Volunteer but keep their last value; a stale
    // MULTI_GRADE stored against a volunteer would resurface if they were
    // later switched back to Teacher.
    setTeacherAdvisorySetting.mockResolvedValueOnce({ ok: true });
    render(<TeacherRoleDialog row={{ ...ROW, advisoryMode: "MULTI_GRADE" }} onSaved={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit role" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByRole("combobox"), {
      target: { value: "Non-DepEd ARAL Volunteer" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setTeacherAdvisorySetting).toHaveBeenCalledTimes(1));
    const sent = formValues(setTeacherAdvisorySetting.mock.calls[0][0]);
    expect(sent.designationKind).toBe("Non-DepEd ARAL Volunteer");
    expect(sent.advisoryMode).toBe("DEFAULT");
  });

  it("opens with Others selected and the stored text for an unrecognized designation", async () => {
    render(
      <TeacherRoleDialog
        row={{ ...ROW, designation: "ARAL Coordinator" }}
        onSaved={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit role" }));
    const dialog = await screen.findByRole("dialog");

    expect((within(dialog).getByRole("combobox") as HTMLSelectElement).value).toBe(
      "__OTHER__"
    );
    expect(within(dialog).getByDisplayValue("ARAL Coordinator")).toBeTruthy();
  });
});
