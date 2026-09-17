import { createRef } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  AralTermGradesGridForm,
  type AralTermGradesGridFormHandle,
} from "@/components/forms/aral-term-grades-grid-form";
import { TermsReportSummary } from "@/components/terms/terms-report-body";
import { termMarkText } from "@/lib/terms/grading-scale";

/**
 * Guards the Grade 1 letter-mark UI added to the End of Terms grid: a G1
 * sheet must show a labelled dropdown per cell (not a number input), never a
 * General Average column, and must still surface a legacy numeric score
 * saved before letter marks existed. A G3 sheet is checked the other way, so
 * a regression that leaks the letter path into every grade is caught too.
 *
 * jsdom renders both the xl table and the phone list (CSS-only hiding), so
 * every query below is scoped to the single `table` role, which only the
 * desktop layout has.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

// terms-report-body.tsx also pulls in the real sheet-data/TermsReportPanel
// modules (Prisma, unlock grants, etc.) just to define the async
// `TermsReportBody`. This test only needs the plain `TermsReportSummary`
// function from the same file, so both are stubbed out to keep the import
// side-effect-free.
vi.mock("@/lib/terms/sheet-data", () => ({ loadTermSheet: vi.fn() }));
vi.mock("@/components/terms/terms-report-panel", () => ({
  TermsReportPanel: () => null,
}));

afterEach(cleanup);

const LEARNER = { id: "l1", fullName: "Ana Cruz", sectionLabel: "1 - Rose" };

function renderGrid(overrides: Partial<Parameters<typeof AralTermGradesGridForm>[0]> = {}) {
  const ref = createRef<AralTermGradesGridFormHandle>();
  const utils = render(
    <AralTermGradesGridForm
      ref={ref}
      subjects={[{ id: "g1-read", name: "Reading" }]}
      learners={[LEARNER]}
      initialGrades={[]}
      gradeType="G1"
      termCaption="First Term - 20%"
      subjectStep={0}
      onNextSubjects={() => {}}
      {...overrides}
    />
  );
  return { ref, ...utils };
}

describe("AralTermGradesGridForm — Grade 1 letter marks", () => {
  it("G1: renders labelled comboboxes, not number inputs, and no General Average header", () => {
    renderGrid({
      subjects: [
        { id: "g1-read", name: "Reading" },
        { id: "g1-math", name: "Mathematics" },
      ],
    });
    const table = screen.getByRole("table");

    expect(within(table).getAllByRole("combobox")).toHaveLength(2);
    expect(
      within(table).getByRole("combobox", { name: "Ana Cruz — Reading grade" })
    ).toBeTruthy();
    expect(
      within(table).getByRole("combobox", { name: "Ana Cruz — Mathematics grade" })
    ).toBeTruthy();
    expect(within(table).queryAllByRole("spinbutton")).toHaveLength(0);
    expect(within(table).queryByText("General")).toBeNull();
    expect(within(table).queryByText("Average")).toBeNull();
  });

  it("G3: still renders number inputs and the General Average column (letter path did not leak)", () => {
    renderGrid({
      gradeType: "G3",
      subjects: [{ id: "g3-eng", name: "English" }],
    });
    const table = screen.getByRole("table");

    expect(within(table).getAllByRole("spinbutton")).toHaveLength(1);
    expect(
      within(table).getByRole("spinbutton", { name: "Ana Cruz — English grade" })
    ).toBeTruthy();
    expect(within(table).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(table).getByText("General")).toBeTruthy();
    expect(within(table).getByText("Average")).toBeTruthy();
  });

  it("G1: a cell holding a legacy numeric score shows that number in the trigger", () => {
    renderGrid({
      initialGrades: [{ learnerId: "l1", termSubjectId: "g1-read", score: 87, mark: null }],
    });
    const table = screen.getByRole("table");
    const trigger = within(table).getByRole("combobox", {
      name: "Ana Cruz — Reading grade",
    });
    expect(trigger.textContent).toContain("87");
  });

  it("G1: picking a letter mark and collecting sends {mark} with no score", async () => {
    const { ref } = renderGrid();
    const table = screen.getByRole("table");
    const trigger = within(table).getByRole("combobox", {
      name: "Ana Cruz — Reading grade",
    });

    fireEvent.click(trigger);
    const option = await screen.findByRole("option", {
      name: termMarkText("BENCHMARKING"),
    });
    fireEvent.click(option);

    const { entries, invalid } = ref.current!.collect();
    expect(invalid).toEqual([]);
    expect(entries).toEqual([
      { learnerId: "l1", termSubjectId: "g1-read", mark: "BENCHMARKING" },
    ]);
    expect(entries[0]).not.toHaveProperty("score");
  });

  /**
   * A legacy-score cell must not sit on the Clear option itself: Radix fires
   * `onValueChange` only when the chosen value differs from the current one, so
   * a cell already on Clear would swallow the click and the old number could
   * never be removed.
   */
  it("G1: clearing a cell that holds a legacy numeric score sends a clear entry", async () => {
    const { ref } = renderGrid({
      initialGrades: [{ learnerId: "l1", termSubjectId: "g1-read", score: 87, mark: null }],
    });
    const table = screen.getByRole("table");
    const trigger = within(table).getByRole("combobox", {
      name: "Ana Cruz — Reading grade",
    });

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "Unassigned" }));

    const { entries, invalid } = ref.current!.collect();
    expect(invalid).toEqual([]);
    expect(entries).toEqual([
      { learnerId: "l1", termSubjectId: "g1-read", score: null, mark: null },
    ]);
  });
});

describe("AralTermGradesGridForm — letter-mark legend", () => {
  it("G1: lists all five marks under the sheet", () => {
    renderGrid();
    for (const mark of ["ADVANCING", "BENCHMARKING", "CONNECTING", "DEVELOPING", "EMERGING"] as const) {
      // Outside the table: the legend sits below it, so a match here is the
      // legend rather than a cell's selected value.
      expect(screen.getAllByText(termMarkText(mark)).length).toBeGreaterThan(0);
    }
  });

  it("G3: shows no letter legend", () => {
    renderGrid({ gradeType: "G3", subjects: [{ id: "g3-eng", name: "English" }] });
    expect(screen.queryByText(termMarkText("ADVANCING"))).toBeNull();
  });
});

describe("TermsReportSummary — letter-scale class average hint", () => {
  const stats = { total: 1, complete: 1, completionPct: 100, classAverage: null };

  it("shows the letter-marks hint when every scope in view is Grade 1", () => {
    render(<TermsReportSummary stats={stats} allLetterScale />);
    expect(screen.getByText("Not computed for letter marks")).toBeTruthy();
    expect(screen.queryByText("Based on saved grades")).toBeNull();
  });

  it("keeps the numeric hint otherwise", () => {
    render(<TermsReportSummary stats={stats} allLetterScale={false} />);
    expect(screen.getByText("Based on saved grades")).toBeTruthy();
    expect(screen.queryByText("Not computed for letter marks")).toBeNull();
  });
});
