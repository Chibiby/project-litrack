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

function ethnicitySelect(container: HTMLElement) {
  return field<HTMLSelectElement>(container, 'select[name="ethnicity"]');
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

const placement = { gradeLabel: "Grade 3", sectionName: "Atis" };

function renderAddForm() {
  return render(
    <LearnerForm
      gradeLevelId="grade-1"
      gradeType="GRADE_3"
      placement={placement}
    />
  );
}

/**
 * The reported bug: "anything i choose in dropdown gets back to not specified".
 *
 * These assert the SELECT'S VISIBLE VALUE, which no existing test does — the
 * cases in learner-form-ethnicity.test.tsx all assert what reached FormData on
 * submit. A select that displays "Not specified" while state holds BISAYA would
 * pass every one of those and still be the bug the teacher is looking at.
 */
describe("LearnerForm ethnicity stays on screen", () => {
  beforeEach(() => {
    createLearner.mockReset();
    updateLearner.mockReset();
  });
  afterEach(cleanup);

  it("shows the chosen ethnicity immediately, with no submit at all", () => {
    const { container } = renderAddForm();
    const select = ethnicitySelect(container);

    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "BISAYA" } });

    expect(ethnicitySelect(container).value).toBe("BISAYA");
  });

  /**
   * The real-browser event order, which `fireEvent.change` alone does NOT
   * simulate. Picking an option in a live browser fires `input` and THEN
   * `change`; jsdom's `fireEvent.change` fires only `change`, which is why
   * every existing ethnicity test passes against a form that is broken on
   * screen. The form carries `onInput={refreshValues}` on the <form> element,
   * so the `input` event re-renders the tree while `ethnicity` state is still
   * stale — and a controlled <select value={ethnicity}> snaps back to "".
   */
  it("survives the real browser's input-then-change order", () => {
    const { container } = renderAddForm();
    const select = ethnicitySelect(container);

    select.value = "BISAYA";
    fireEvent.input(select);
    fireEvent.change(select);

    expect(ethnicitySelect(container).value).toBe("BISAYA");
  });

  it("keeps the chosen ethnicity after the server refuses the save", async () => {
    createLearner.mockResolvedValue({ ok: false, error: "Something went wrong" });
    const { container } = renderAddForm();

    fillRequired(container);
    fireEvent.change(ethnicitySelect(container), { target: { value: "ILONGGO" } });
    await submit(container);

    await waitFor(() => expect(createLearner).toHaveBeenCalled());
    expect(ethnicitySelect(container).value).toBe("ILONGGO");
  });

  it("keeps the chosen ethnicity while a duplicate warning is pending", async () => {
    createLearner.mockResolvedValue({ ok: false, error: "possible_duplicate" });
    const { container } = renderAddForm();

    fillRequired(container);
    fireEvent.change(ethnicitySelect(container), { target: { value: "TAGALOG" } });
    await submit(container);

    await waitFor(() => expect(createLearner).toHaveBeenCalled());
    expect(ethnicitySelect(container).value).toBe("TAGALOG");
  });

  it("clears the ethnicity only on a successful create", async () => {
    createLearner.mockResolvedValue({ ok: true });
    const { container } = renderAddForm();

    fillRequired(container);
    fireEvent.change(ethnicitySelect(container), { target: { value: "MARANAO" } });
    await submit(container);

    await waitFor(() => expect(createLearner).toHaveBeenCalled());
    expect(ethnicitySelect(container).value).toBe("");
  });
});
