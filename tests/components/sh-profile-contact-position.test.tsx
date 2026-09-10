import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two fields the School Head form gained: an editable contact email and a
 * position picker.
 *
 * Both used to be `ReadOnlyField`s. Email showed the Supabase login identity —
 * for most heads a synthetic `sh@<schoolIdCode>` address nobody can receive mail
 * at — and position showed a hard-coded Principal I that a Head Teacher running a
 * small school had no way to correct. These tests cover both surfaces, because
 * one component serves the onboarding wizard and the settings page: the picker
 * has to reach a not-yet-profiled head, not just an existing one.
 */

beforeAll(() => {
  // jsdom gaps the real form depends on: Radix probes pointer capture, its
  // sizing hook builds a ResizeObserver, and the wizard scrolls on step change.
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
  usePathname: () => "/school-head/settings/profile",
  useSearchParams: () => new URLSearchParams(""),
}));

const saveSchoolHeadProfile = vi.fn(async () => ({ ok: true }) as
  | { ok: true }
  | { ok: false; error: string });
vi.mock("@/lib/actions/school-head", () => ({
  saveSchoolHeadProfile: (...args: unknown[]) => saveSchoolHeadProfile(...(args as [])),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { SchoolHeadProfileForm } = await import("@/components/forms/sh-profile-form");

/** A profile that clears every per-step check, so nothing else blocks a save. */
const COMPLETE = {
  firstName: "Maria",
  lastName: "Santos",
  accountEmail: "sh@ABC123.litrack.local",
  accountEmailIsSynthetic: true,
  contactEmail: "head@school.deped.gov.ph",
  position: "PRINCIPAL_II",
  educationalAttainment: "BACHELORS",
  fieldOfSpecialization: "ENGLISH",
  yearsInService: 4,
  hasReadingTraining: false,
  readingTrainings: [],
  hasEnglishTraining: false,
  englishTrainings: [],
  highestTrainingLevel: "DIVISION",
};

beforeEach(() => {
  vi.clearAllMocks();
  saveSchoolHeadProfile.mockResolvedValue({ ok: true });
});

afterEach(cleanup);

/** The FormData the form submitted, as a plain object. */
function submittedPayload(): Record<string, string> {
  const [fd] = (saveSchoolHeadProfile.mock.calls[0] ?? []) as unknown as [FormData?];
  if (!fd) throw new Error("the form never submitted");
  const out: Record<string, string> = {};
  for (const [key, value] of fd.entries()) out[key] = String(value);
  return out;
}

describe("School Head profile — contact email", () => {
  it("renders the stored address in an editable field", () => {
    render(<SchoolHeadProfileForm presentation="edit" defaultValues={COMPLETE} />);

    const field = screen.getByLabelText("Email address") as HTMLInputElement;
    expect(field.value).toBe("head@school.deped.gov.ph");
    expect(field.readOnly).toBe(false);
    expect(field.disabled).toBe(false);
    expect(field.type).toBe("email");
  });

  it("submits an edited address", async () => {
    render(<SchoolHeadProfileForm presentation="edit" defaultValues={COMPLETE} />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "new.head@school.deped.gov.ph" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(saveSchoolHeadProfile).toHaveBeenCalled());
    expect(submittedPayload().contactEmail).toBe("new.head@school.deped.gov.ph");
  });

  // The login identity is a separate thing, and for a School Head it is usually
  // synthetic. It stays on screen so the head can quote it to an administrator,
  // but it is not what this field edits.
  it("keeps the sign-in identity visible and read-only", () => {
    render(<SchoolHeadProfileForm presentation="edit" defaultValues={COMPLETE} />);

    const signIn = screen.getByDisplayValue("sh@ABC123.litrack.local") as HTMLInputElement;
    expect(signIn.readOnly).toBe(true);
    expect(screen.getByText(/synthetic login identity/i)).toBeTruthy();
  });

  it("refuses a malformed address without sending it", async () => {
    render(<SchoolHeadProfileForm presentation="edit" defaultValues={COMPLETE} />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    });
    expect(saveSchoolHeadProfile).not.toHaveBeenCalled();
  });

  it("lets a head clear the address, since it is optional", async () => {
    render(<SchoolHeadProfileForm presentation="edit" defaultValues={COMPLETE} />);

    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(saveSchoolHeadProfile).toHaveBeenCalled());
    expect(submittedPayload().contactEmail ?? "").toBe("");
  });
});

describe("School Head profile — position picker", () => {
  it("renders the stored rank in a select, not a disabled box", () => {
    render(<SchoolHeadProfileForm presentation="edit" defaultValues={COMPLETE} />);

    // Radix renders the trigger as a combobox showing the current label.
    const trigger = screen.getByRole("combobox", { name: /position/i });
    expect(trigger.textContent).toContain("Principal II");
    expect(trigger.getAttribute("disabled")).toBeNull();
  });

  it("offers Principal I–IV under a Principal heading, other ranks below", async () => {
    render(<SchoolHeadProfileForm presentation="edit" defaultValues={COMPLETE} />);

    fireEvent.click(screen.getByRole("combobox", { name: /position/i }));

    await waitFor(() => expect(screen.getByText("Principal")).toBeTruthy());
    expect(screen.getByText("Other school head ranks")).toBeTruthy();

    for (const label of ["Principal I", "Principal II", "Principal III", "Principal IV"]) {
      expect(screen.getByRole("option", { name: label })).toBeTruthy();
    }
    // The second group is why a small school led by a Head Teacher can profile.
    expect(screen.getByRole("option", { name: "Head Teacher III" })).toBeTruthy();
  });

  it("submits the rank the head selected", async () => {
    render(<SchoolHeadProfileForm presentation="edit" defaultValues={COMPLETE} />);

    fireEvent.click(screen.getByRole("combobox", { name: /position/i }));
    await waitFor(() => expect(screen.getByRole("option", { name: "Principal IV" })).toBeTruthy());
    fireEvent.click(screen.getByRole("option", { name: "Principal IV" }));

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(saveSchoolHeadProfile).toHaveBeenCalled());
    expect(submittedPayload().position).toBe("PRINCIPAL_IV");
  });
});

/**
 * The wizard is the surface a not-yet-profiled head lands on. Both fields have to
 * be there too — the request was for the profiling flow as much as for settings.
 */
describe("School Head profiling wizard — a head with no profile yet", () => {
  it("shows both fields on the first step, with Principal I preselected", () => {
    render(
      <SchoolHeadProfileForm
        defaultValues={{
          firstName: "",
          lastName: "",
          accountEmail: "sh@ABC123.litrack.local",
          accountEmailIsSynthetic: true,
        }}
      />
    );

    const emailField = screen.getByLabelText("Email address") as HTMLInputElement;
    expect(emailField.value).toBe("");
    expect(emailField.readOnly).toBe(false);

    // A blank profile opens on the common answer rather than on nothing.
    expect(screen.getByRole("combobox", { name: /position/i }).textContent).toContain(
      "Principal I"
    );
  });

  it("blocks the step on a malformed address instead of failing at submit", async () => {
    render(
      <SchoolHeadProfileForm
        defaultValues={{ firstName: "Maria", lastName: "Santos", accountEmail: "sh@x.local" }}
      />
    );

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "nope@" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    });
  });

  it("advances past the step when the address is simply left blank", async () => {
    render(
      <SchoolHeadProfileForm
        defaultValues={{ firstName: "Maria", lastName: "Santos", accountEmail: "sh@x.local" }}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => {
      expect(screen.queryByText("Enter a valid email address")).toBeNull();
      expect(screen.getByLabelText(/Highest Educational Attainment/i)).toBeTruthy();
    });
  });
});
