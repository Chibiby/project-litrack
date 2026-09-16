import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Owner bug: on the numeric End of Terms sheet, a teacher whose advisories
 * mix Kindergarten with other grades still saw and could default to
 * "All advisories" — a combined view that cannot exist because Kindergarten
 * has no numeric grid. The dropdown must drop "All advisories" whenever
 * `kinderSectionIds` is non-empty, while a teacher with no Kindergarten
 * advisory keeps today's behavior.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/terms-reports",
  useSearchParams: () => new URLSearchParams(""),
}));

const { TermsAdvisoryHeroControl } = await import(
  "@/components/terms/terms-advisory-hero-control"
);

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

function open() {
  fireEvent.click(screen.getByRole("combobox", { name: "Advisory" }));
}

const ADVISORIES = [
  { id: "kinder-barbie", label: "Kindergarten · Barbie" },
  { id: "g3-orange", label: "Grade 3 · Orange" },
];

describe("TermsAdvisoryHeroControl", () => {
  it("hides All advisories for a teacher whose advisories mix Kindergarten with other grades", () => {
    render(
      <TermsAdvisoryHeroControl
        basePath="/teacher/terms-reports"
        state={{ advisory: "g3-orange", section: "all", term: "FIRST", q: "", pageSize: 10 }}
        advisories={ADVISORIES}
        kinderSectionIds={["kinder-barbie"]}
        kinderBasePath="/teacher/terms-reports/kinder"
      />
    );
    open();
    expect(screen.queryByRole("option", { name: "All advisories" })).toBeNull();
  });

  it("keeps All advisories for a teacher with no Kindergarten advisory", () => {
    render(
      <TermsAdvisoryHeroControl
        basePath="/teacher/terms-reports"
        state={{ advisory: null, section: "all", term: "FIRST", q: "", pageSize: 10 }}
        advisories={[{ id: "g3-orange", label: "Grade 3 · Orange" }]}
      />
    );
    open();
    expect(screen.getByRole("option", { name: "All advisories" })).toBeTruthy();
  });

  it("routes a Kindergarten pick to the checklist route, preserving schoolId", () => {
    render(
      <TermsAdvisoryHeroControl
        basePath="/teacher/terms-reports"
        state={{
          advisory: "g3-orange",
          section: "all",
          term: "FIRST",
          q: "",
          pageSize: 10,
          schoolId: "school-1",
        }}
        advisories={ADVISORIES}
        kinderSectionIds={["kinder-barbie"]}
        kinderBasePath="/teacher/terms-reports/kinder"
      />
    );
    open();
    fireEvent.click(screen.getByText("Kindergarten · Barbie"));
    expect(push).toHaveBeenCalledWith(
      "/teacher/terms-reports/kinder?schoolId=school-1&advisory=kinder-barbie",
      { scroll: false }
    );
  });
});
