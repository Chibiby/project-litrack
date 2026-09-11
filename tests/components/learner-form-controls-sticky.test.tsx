import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/actions/learner", () => ({
  createLearner: vi.fn(),
  updateLearner: vi.fn(),
}));

import { LearnerForm } from "@/components/forms/learner-form";

function renderAddForm() {
  return render(
    <LearnerForm
      gradeLevelId="grade-1"
      gradeType="GRADE_3"
      placement={{ gradeLabel: "Grade 3", sectionName: "Atis" }}
    />
  );
}

/**
 * The snap-back bug was never specific to ethnicity. The form carried
 * `onInput={refreshValues}`, and a browser fires `input` before `change` on a
 * <select> — so the form-level snapshot re-rendered while the control's own
 * state was still stale, and React re-applied the old controlled value. Every
 * controlled <select> in this form had it.
 *
 * Rather than name the five by hand and risk missing one a later change adds,
 * this enumerates every named <select> the form renders and drives each through
 * the real browser's event order.
 */
describe("every controlled select in the learner form holds its value", () => {
  afterEach(cleanup);

  it("keeps the picked option for each select, in input-then-change order", () => {
    const { container } = renderAddForm();
    const selects = [...container.querySelectorAll<HTMLSelectElement>("select[name]")];

    // Guards against the enumeration silently finding nothing and passing.
    expect(selects.length).toBeGreaterThan(0);

    for (const select of selects) {
      const option = [...select.options].find((o) => o.value !== "");
      if (!option) continue;

      select.value = option.value;
      fireEvent.input(select);
      fireEvent.change(select);

      const live = container.querySelector<HTMLSelectElement>(
        `select[name="${select.name}"]`
      );
      expect(
        live?.value,
        `select[name="${select.name}"] snapped back instead of holding "${option.value}"`
      ).toBe(option.value);
    }
  });
});

/**
 * Regression guard for the fix itself.
 *
 * `onInput` was on the <form> so the completion bar could follow typing —
 * `change` on a text input only fires on blur, so a naive swap to `onChange`
 * would have frozen the "N left" chips until the teacher left the field.
 * React's `onChange` is wired to the native `input` event for text inputs, so
 * it still fires per keystroke; this proves that rather than assuming it.
 */
describe("the completion bar still follows typing", () => {
  afterEach(cleanup);

  it("updates the remaining-field count on a keystroke, with no blur", () => {
    const { container } = renderAddForm();

    const before = container.textContent ?? "";
    const leftBefore = [...before.matchAll(/(\d+) left/g)].map((m) => Number(m[1]));
    expect(leftBefore.length, "no 'N left' chips rendered to measure").toBeGreaterThan(0);
    const totalBefore = leftBefore.reduce((a, b) => a + b, 0);

    const firstName = container.querySelector<HTMLInputElement>('input[name="firstName"]');
    expect(firstName).not.toBeNull();

    // `input`, not `change`: this is what a keystroke produces. No blur.
    if (firstName) {
      firstName.value = "Juan";
      fireEvent.input(firstName);
    }

    const after = container.textContent ?? "";
    const totalAfter = [...after.matchAll(/(\d+) left/g)]
      .map((m) => Number(m[1]))
      .reduce((a, b) => a + b, 0);

    expect(
      totalAfter,
      "the remaining-field count did not move on a keystroke — the completion bar stopped following typing"
    ).toBeLessThan(totalBefore);
  });
});
