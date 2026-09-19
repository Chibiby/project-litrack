import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Teacher Settings v2: Cancel and Save Changes sit outside the <form>, and the
 * form must still validate, show its pending state, and guard unsaved edits.
 * The onboarding wizard (default presentation) must not pick any of it up.
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/settings/profile",
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span data-testid="hero-art" aria-label={alt} />,
}));

const saveTeacherProfile = vi.fn(async () => ({ ok: true }) as
  | { ok: true }
  | { ok: false; error: string });
vi.mock("@/lib/actions/teacher", () => ({
  saveTeacherProfile: (...args: unknown[]) => saveTeacherProfile(...(args as [])),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { TeacherProfileForm } = await import("@/components/forms/teacher-profile-form");
const { TeacherSettingsShell } = await import("@/components/settings/teacher-settings-shell");

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

function renderEdit() {
  return render(
    <TeacherProfileForm presentation="edit" defaultValues={COMPLETE} gradeLevels={GRADE_LEVELS} />
  );
}

function beforeUnloadBlocked(): boolean {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

beforeEach(() => {
  vi.clearAllMocks();
  saveTeacherProfile.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

describe("teacher settings v2 — header Save Changes", () => {
  it("sits outside the form and still submits it", async () => {
    renderEdit();
    const save = screen.getByRole("button", { name: "Save Changes" });
    expect(save.closest("form")).toBeNull();
    expect(save.getAttribute("form")).toBe(document.querySelector("form")?.id);

    fireEvent.click(save);
    await waitFor(() => expect(saveTeacherProfile).toHaveBeenCalledTimes(1));
  });

  it("leaves no second save button inside the form", () => {
    renderEdit();
    const form = document.querySelector("form") as HTMLFormElement;
    expect(within(form).queryByRole("button", { name: /save/i })).toBeNull();
  });

  it("still validates before saving", async () => {
    renderEdit();
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.getAllByText("First name is required").length).toBeGreaterThan(0));
    expect(saveTeacherProfile).not.toHaveBeenCalled();
  });

  it("shows the pending state while the save runs", async () => {
    saveTeacherProfile.mockImplementation(() => new Promise(() => {}));
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(screen.getByRole("button", { name: /Saving…/ })).toBeTruthy());
    expect((screen.getByRole("button", { name: /Saving…/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("teacher settings v2 — Cancel and the unsaved guard", () => {
  it("guards an edit, and Cancel restores the saved value and lifts the guard", async () => {
    renderEdit();
    const firstName = screen.getByLabelText(/First name/) as HTMLInputElement;

    fireEvent.change(firstName, { target: { value: "Pedro" } });
    await waitFor(() => expect(beforeUnloadBlocked()).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(firstName.value).toBe("Juan"));
    await waitFor(() => expect(beforeUnloadBlocked()).toBe(false));
    expect(saveTeacherProfile).not.toHaveBeenCalled();
  });
});

describe("teacher settings v2 — not built yet", () => {
  it("shows the photo controls disabled with the reason", () => {
    renderEdit();
    for (const name of ["Change Photo", "Remove"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      const describedBy = button.getAttribute("aria-describedby");
      expect(describedBy && document.getElementById(describedBy)?.textContent).toBe(
        "Photo upload is coming soon."
      );
    }
  });

  it("renders Account Preferences and Notifications inert, with Profile and Security as links", () => {
    render(
      <TeacherSettingsShell active="profile" bannerSrc="/brand/banner-teacher-female.webp">
        <p>content</p>
      </TeacherSettingsShell>
    );
    const nav = screen.getByRole("navigation", { name: "Settings" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Profile", "Security"]);
    expect(within(nav).getByRole("link", { name: "Profile" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByText(/Account Preferences — coming soon/)).toBeTruthy();
    expect(within(nav).getByText(/Notifications — coming soon/)).toBeTruthy();
    expect(within(nav).getAllByText("Soon")).toHaveLength(2);
    expect(screen.getByRole("heading", { level: 1, name: "Profile Settings" })).toBeTruthy();
  });
});

describe("onboarding wizard is untouched", () => {
  it("has no Settings header buttons, summary slot or photo card", () => {
    render(
      <TeacherProfileForm
        defaultValues={COMPLETE}
        gradeLevels={GRADE_LEVELS}
        summary={<p>summary</p>}
      />
    );
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByText("summary")).toBeNull();
    expect(screen.queryByText("Profile Photo & Identity")).toBeNull();
    expect(screen.getByText("I. Respondent Information")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue" })).toBeTruthy();
  });
});
