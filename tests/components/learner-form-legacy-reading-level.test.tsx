import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LEGACY_READING_VALUE_MESSAGE } from "@/lib/reading/policy";

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

function renderEdit(gradeType: string, profile: string) {
  return render(
    <LearnerForm
      gradeLevelId="g1"
      gradeType={gradeType}
      mode="edit"
      defaultValues={{
        id: "l1",
        firstName: "Juan",
        lastName: "Cruz",
        age: 8,
        gender: "MALE",
        nutritionalStatus: "NORMAL",
        ethnicity: null,
        englishReadingProfile: profile,
        filipinoReadingProfile: profile,
        parentEducation: "ELEMENTARY_LEVEL",
      }}
    />
  );
}

function radioValues(container: HTMLElement, name: string): string[] {
  return [
    ...container.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`),
  ].map((r) => r.value);
}

afterEach(cleanup);

describe("learner form — legacy Grade 1-3 reading level", () => {
  it("offers the five Grade 1-3 levels and never the old combined one", () => {
    const { container } = renderEdit("G3", "INSTRUCTIONAL_DEVELOPING");
    for (const name of ["englishReadingProfile", "filipinoReadingProfile"]) {
      expect(radioValues(container, name)).toEqual([
        "NON_DECODER_LOW_EMERGENT",
        "FRUSTRATION_HIGH_EMERGENT",
        "DEVELOPING",
        "TRANSITIONING",
        "INDEPENDENT_GRADE_READY",
      ]);
    }
  });

  it("leaves the field empty and tells the teacher to re-pick", () => {
    const { container } = renderEdit("G3", "INSTRUCTIONAL_DEVELOPING");
    const checked = container.querySelectorAll('input[type="radio"]:checked[name$="ReadingProfile"]');
    expect(checked).toHaveLength(0);
    expect(screen.getAllByText(LEGACY_READING_VALUE_MESSAGE).length).toBeGreaterThan(0);
  });

  it("keeps Instructional for Grade 4 and shows no warning", () => {
    const { container } = renderEdit("G4", "INSTRUCTIONAL_DEVELOPING");
    expect(radioValues(container, "filipinoReadingProfile")).toContain(
      "INSTRUCTIONAL_DEVELOPING"
    );
    expect(
      container.querySelector<HTMLInputElement>(
        'input[type="radio"][name="filipinoReadingProfile"]:checked'
      )?.value
    ).toBe("INSTRUCTIONAL_DEVELOPING");
    expect(screen.queryByText(LEGACY_READING_VALUE_MESSAGE)).toBeNull();
  });
});
