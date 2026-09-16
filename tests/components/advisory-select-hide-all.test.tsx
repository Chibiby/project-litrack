import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AdvisorySelect } from "@/components/learners/advisory-select";

/**
 * `showAllOption` is additive: every existing caller (the Learners page)
 * keeps "All advisories" by default. Only the End of Terms hero, for a
 * teacher whose advisories mix Kindergarten with other grades, passes
 * `false` (owner decision — no combined view spans both report shapes).
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

const ADVISORIES = [
  { id: "g3-orange", label: "Grade 3 · Orange" },
  { id: "g4-apple", label: "Grade 4 · Apple" },
];

function open() {
  fireEvent.click(screen.getByRole("combobox", { name: "Advisory" }));
}

describe("AdvisorySelect", () => {
  it("shows All advisories by default, unaffected callers unchanged", () => {
    render(<AdvisorySelect advisories={ADVISORIES} value={null} onChange={() => {}} />);
    open();
    expect(screen.getByRole("option", { name: "All advisories" })).toBeTruthy();
  });

  it("hides All advisories when showAllOption is false", () => {
    render(
      <AdvisorySelect
        advisories={ADVISORIES}
        value="g3-orange"
        onChange={() => {}}
        showAllOption={false}
      />
    );
    open();
    expect(screen.queryByRole("option", { name: "All advisories" })).toBeNull();
    expect(screen.getByRole("option", { name: "Grade 3 · Orange" })).toBeTruthy();
  });
});
