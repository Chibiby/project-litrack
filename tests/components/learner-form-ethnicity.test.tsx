import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/learners",
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => "toast-id"),
  }),
}));

vi.mock("@/components/nav-prefetcher", () => ({ invalidateNavWarm: vi.fn() }));

const createLearner = vi.fn();
const updateLearner = vi.fn();
vi.mock("@/lib/actions/learner", () => ({
  createLearner: (fd: FormData) => createLearner(fd),
  updateLearner: (fd: FormData) => updateLearner(fd),
}));

import { LearnerForm } from "@/components/forms/learner-form";

function field<T extends Element>(container: HTMLElement, selector: string): T {
  const el = container.querySelector<T>(selector);
  if (!el) throw new Error(`missing ${selector}`);
  return el;
}

function fillRequired(container: HTMLElement) {
  fireEvent.change(field<HTMLInputElement>(container, 'input[name="firstName"]'), {
    target: { value: "Juan" },
  });
  fireEvent.change(field<HTMLInputElement>(container, 'input[name="lastName"]'), {
    target: { value: "Cruz" },
  });
  fireEvent.change(field<HTMLInputElement>(container, 'input[name="age"]'), {
    target: { value: "9" },
  });
  for (const name of [
    "gender",
    "nutritionalStatus",
    "englishReadingProfile",
    "filipinoReadingProfile",
    "parentEducation",
  ]) {
    fireEvent.click(field<HTMLInputElement>(container, `input[type="radio"][name="${name}"]`));
  }
}

async function submit(container: HTMLElement) {
  const button = field<HTMLButtonElement>(container, 'button[type="submit"]');
  await act(async () => {
    fireEvent.click(button);
  });
}

describe("LearnerForm ethnicity", () => {
  beforeEach(() => {
    createLearner.mockReset();
    updateLearner.mockReset();
  });
  afterEach(cleanup);

  it("submits the chosen ethnicity on create", async () => {
    createLearner.mockResolvedValue({ ok: true, data: { id: "l1" } });
    const { container } = render(<LearnerForm gradeLevelId="g1" gradeType="G4" />);

    fillRequired(container);
    fireEvent.change(field<HTMLSelectElement>(container, 'select[name="ethnicity"]'), {
      target: { value: "BISAYA" },
    });
    await submit(container);

    await waitFor(() => expect(createLearner).toHaveBeenCalledTimes(1));
    const fd = createLearner.mock.calls[0][0] as FormData;
    expect(fd.get("ethnicity")).toBe("BISAYA");
  });

  it("still submits the chosen ethnicity on the Create anyway resubmit", async () => {
    createLearner
      .mockResolvedValueOnce({ ok: false, error: "possible_duplicate", data: { id: "x" } })
      .mockResolvedValueOnce({ ok: true, data: { id: "l1" } });
    const { container } = render(<LearnerForm gradeLevelId="g1" gradeType="G4" />);

    fillRequired(container);
    fireEvent.change(field<HTMLSelectElement>(container, 'select[name="ethnicity"]'), {
      target: { value: "MARANAO" },
    });
    await submit(container);
    await waitFor(() => expect(createLearner).toHaveBeenCalledTimes(1));

    // The select must still show what the teacher chose after the warning.
    await waitFor(() =>
      expect(field<HTMLSelectElement>(container, 'select[name="ethnicity"]').value).toBe(
        "MARANAO"
      )
    );

    await submit(container);
    await waitFor(() => expect(createLearner).toHaveBeenCalledTimes(2));
    const fd = createLearner.mock.calls[1][0] as FormData;
    expect(fd.get("ethnicity")).toBe("MARANAO");
    expect(fd.get("firstName")).toBe("Juan");
  });

  it("submits a changed ethnicity on edit", async () => {
    updateLearner.mockResolvedValue({ ok: true });
    const { container } = render(
      <LearnerForm
        gradeLevelId="g1"
        gradeType="G4"
        mode="edit"
        defaultValues={{
          id: "l1",
          firstName: "Juan",
          lastName: "Cruz",
          age: 9,
          gender: "MALE",
          nutritionalStatus: "NORMAL",
          ethnicity: null,
          englishReadingProfile: "INDEPENDENT_GRADE_READY",
          filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
          parentEducation: "ELEMENTARY_LEVEL",
        }}
      />
    );

    fireEvent.change(field<HTMLSelectElement>(container, 'select[name="ethnicity"]'), {
      target: { value: "TAGALOG" },
    });
    await submit(container);

    await waitFor(() => expect(updateLearner).toHaveBeenCalledTimes(1));
    const fd = updateLearner.mock.calls[0][0] as FormData;
    expect(fd.get("ethnicity")).toBe("TAGALOG");
  });
});
