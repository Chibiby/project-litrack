import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner bug: on the Kinder checklist, the hero's advisory dropdown was
 * missing whenever the teacher held only Kindergarten advisories, and even
 * when shown it never listed a teacher's non-Kindergarten sections — so a
 * teacher advising both "Kinder - Barbie" and "Grade 3 - Orange" had no way
 * back to their numeric sheet. The fix: the control always renders, lists
 * every advisory the teacher holds, and routes a non-Kindergarten pick to
 * the numeric sheet.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/terms-reports/kinder",
  useSearchParams: () => new URLSearchParams(""),
}));

const { KinderAdvisoryHeroControl } = await import(
  "@/components/terms/kinder-advisory-hero-control"
);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

function open() {
  fireEvent.click(screen.getByRole("combobox", { name: "Kindergarten advisory" }));
}

describe("KinderAdvisoryHeroControl", () => {
  it("lists both the Kindergarten and non-Kindergarten advisories the teacher holds", () => {
    render(
      <KinderAdvisoryHeroControl
        schoolId="school-1"
        advisories={[
          { id: "kinder-barbie", label: "Kindergarten · Barbie" },
          { id: "g3-orange", label: "Grade 3 · Orange" },
        ]}
        value="kinder-barbie"
        numericSectionIds={["g3-orange"]}
        numericBasePath="/teacher/terms-reports"
      />
    );
    open();
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Kindergarten · Barbie",
      "Grade 3 · Orange",
    ]);
  });

  it("routes a non-Kindergarten pick to the numeric sheet, preserving schoolId", () => {
    render(
      <KinderAdvisoryHeroControl
        schoolId="school-1"
        advisories={[
          { id: "kinder-barbie", label: "Kindergarten · Barbie" },
          { id: "g3-orange", label: "Grade 3 · Orange" },
        ]}
        value="kinder-barbie"
        numericSectionIds={["g3-orange"]}
        numericBasePath="/teacher/terms-reports"
      />
    );
    open();
    fireEvent.click(screen.getByText("Grade 3 · Orange"));
    expect(push).toHaveBeenCalledWith(
      "/teacher/terms-reports?schoolId=school-1&advisory=g3-orange",
      { scroll: false }
    );
  });

  it("routes another Kindergarten pick to the checklist route instead", () => {
    render(
      <KinderAdvisoryHeroControl
        schoolId="school-1"
        advisories={[
          { id: "kinder-barbie", label: "Kindergarten · Barbie" },
          { id: "kinder-rose", label: "Kindergarten · Rose" },
          { id: "g3-orange", label: "Grade 3 · Orange" },
        ]}
        value="kinder-barbie"
        numericSectionIds={["g3-orange"]}
        numericBasePath="/teacher/terms-reports"
      />
    );
    open();
    fireEvent.click(screen.getByText("Kindergarten · Rose"));
    expect(push).toHaveBeenCalledWith(
      "/teacher/terms-reports/kinder?schoolId=school-1&advisory=kinder-rose",
      { scroll: false }
    );
  });
});
