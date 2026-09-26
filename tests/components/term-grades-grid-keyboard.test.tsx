import { createRef } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AralTermGradesGridForm,
  type AralTermGradesGridFormHandle,
} from "@/components/forms/aral-term-grades-grid-form";

/**
 * Covers the keyboard navigation wired onto the NUMERIC-scale score cells via
 * `onKeyDown` (grid-keyboard-nav.ts). Uses a G3 (numeric) sheet with two
 * learners x two subjects, so both a row move (Enter) and a column move
 * (ArrowRight) land on a real neighbouring cell.
 *
 * jsdom renders both the desktop table and the phone list — both are
 * `[data-grid-container]`s — so every query below is scoped to the one that
 * holds the `table` role.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock("@/lib/terms/sheet-data", () => ({ loadTermSheet: vi.fn() }));
vi.mock("@/components/terms/terms-report-panel", () => ({
  TermsReportPanel: () => null,
}));

afterEach(cleanup);

const LEARNERS = [
  { id: "l1", fullName: "Ana Cruz", sectionLabel: "3 - Rose" },
  { id: "l2", fullName: "Ben Reyes", sectionLabel: "3 - Rose" },
];
const SUBJECTS = [
  { id: "s-read", name: "Reading" },
  { id: "s-math", name: "Mathematics" },
];

function renderGrid() {
  const ref = createRef<AralTermGradesGridFormHandle>();
  render(
    <AralTermGradesGridForm
      ref={ref}
      subjects={SUBJECTS}
      learners={LEARNERS}
      initialGrades={[]}
      gradeType="G3"
      termCaption="First Term - 20%"
      subjectStep={0}
      onNextSubjects={() => {}}
    />
  );
  const table = screen.getByRole("table");
  const container = table.closest("[data-grid-container]") as HTMLElement;
  return { ref, container };
}

function cell(container: HTMLElement, learnerName: string, subjectName: string) {
  return within(container).getByRole("textbox", {
    name: `${learnerName} — ${subjectName} grade`,
  }) as HTMLInputElement;
}

describe("AralTermGradesGridForm — score cell keyboard navigation", () => {
  it("Enter moves focus to the same column in the next learner row", () => {
    const { container } = renderGrid();
    const anaReading = cell(container, "Ana Cruz", "Reading");
    const benReading = cell(container, "Ben Reyes", "Reading");

    anaReading.focus();
    fireEvent.keyDown(anaReading, { key: "Enter" });

    expect(document.activeElement).toBe(benReading);
  });

  it("ArrowRight with caret at end moves to the next column; mid-value it does not move", () => {
    const { container } = renderGrid();
    const anaReading = cell(container, "Ana Cruz", "Reading");
    const anaMath = cell(container, "Ana Cruz", "Mathematics");

    fireEvent.change(anaReading, { target: { value: "85" } });
    anaReading.focus();
    anaReading.setSelectionRange(2, 2); // caret at the end of "85"
    fireEvent.keyDown(anaReading, { key: "ArrowRight" });

    expect(document.activeElement).toBe(anaMath);

    // Reset and try again with the caret in the middle of the value.
    anaMath.blur();
    anaReading.focus();
    anaReading.setSelectionRange(1, 1); // caret between "8" and "5"
    fireEvent.keyDown(anaReading, { key: "ArrowRight" });

    expect(document.activeElement).toBe(anaReading);
  });

  it("Enter on the last row does not move focus and is default-prevented", () => {
    const { container } = renderGrid();
    const benReading = cell(container, "Ben Reyes", "Reading");

    benReading.focus();
    const notPrevented = fireEvent.keyDown(benReading, { key: "Enter" });

    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(benReading);
  });
});
