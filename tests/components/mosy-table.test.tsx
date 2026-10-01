import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/aral-mosy", () => ({ saveMosyDecision: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/teacher/aral/mosy",
  useSearchParams: () => new URLSearchParams(),
}));

import { MosyTable } from "@/components/aral/mosy-table";
import type { MosyRow } from "@/lib/aral/mosy-queries";

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

function makeRow(overrides: Partial<MosyRow>): MosyRow {
  return {
    id: "learner-1",
    fullName: "Ana Cruz",
    gradeLevelId: "g3",
    gradeType: "G3",
    gradeLabel: "Grade 3",
    sectionName: "Atis",
    isAralLearner: true,
    status: "not_updated",
    levelOptions: [],
    reasonChoices: [],
    mosyLevel: null,
    mosyLevelLabel: null,
    mosyLanguage: "ENGLISH",
    decision: null,
    reason: null,
    improvedToLevel: null,
    reasonLabel: null,
    remarks: null,
    previousLevel: null,
    ...overrides,
  };
}

function renderTable(rows: MosyRow[]) {
  return render(
    <MosyTable
      rows={rows}
      totalCount={rows.length}
      page={1}
      pageSize={20}
      totalPages={1}
      status="all"
      canEdit
    />
  );
}

describe("MosyTable", () => {
  it("has separate Reason and Remarks columns", () => {
    renderTable([makeRow({})]);
    expect(screen.getByRole("columnheader", { name: "Reason" })).not.toBeNull();
    expect(screen.getByRole("columnheader", { name: "Remarks" })).not.toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Remarks \/ Reason/ })).toBeNull();
  });

  it("puts reason and remarks in their own cells, and a dash when empty", () => {
    renderTable([
      makeRow({ id: "a", reasonLabel: "Diagnosed LSEN", remarks: "Referred to SPED" }),
      makeRow({ id: "b", fullName: "Ben Reyes" }),
    ]);
    const [, first, second] = screen.getAllByRole("row");
    const firstCells = within(first!).getAllByRole("cell");
    expect(firstCells[6]!.textContent).toBe("Diagnosed LSEN");
    expect(firstCells[7]!.textContent).toBe("Referred to SPED");
    const secondCells = within(second!).getAllByRole("cell");
    expect(secondCells[6]!.textContent).toBe("—");
    expect(secondCells[7]!.textContent).toBe("—");
  });

  it("prefixes the MOSY level with its language", () => {
    renderTable([
      makeRow({ id: "a", gradeType: "G1", mosyLanguage: "FILIPINO", mosyLevelLabel: "Low Emergent" }),
      makeRow({ id: "b", mosyLanguage: "ENGLISH", mosyLevelLabel: "Developing" }),
      makeRow({ id: "c" }),
    ]);
    const rows = screen.getAllByRole("row").slice(1);
    const levelCell = (i: number) => within(rows[i]!).getAllByRole("cell")[4]!;
    // What a sighted reader sees: the aria-hidden abbreviation, not the sr-only name.
    const visible = (el: HTMLElement) =>
      Array.from(el.querySelectorAll<HTMLElement>("span"))
        .filter((s) => !s.classList.contains("sr-only"))
        .map((s) => s.textContent)
        .join("");
    expect(visible(levelCell(0))).toContain("Fil:");
    expect(levelCell(0).textContent).toContain("Low Emergent");
    expect(visible(levelCell(1))).toContain("Eng:");
    expect(levelCell(2).textContent).toBe("—");
  });

  it("gives screen readers the full language name, not the abbreviation", () => {
    renderTable([
      makeRow({ id: "a", gradeType: "G1", mosyLanguage: "FILIPINO", mosyLevelLabel: "Low Emergent" }),
      makeRow({ id: "b", mosyLanguage: "ENGLISH", mosyLevelLabel: "Developing" }),
    ]);
    const rows = screen.getAllByRole("row").slice(1);
    const cell = (i: number) => within(rows[i]!).getAllByRole("cell")[4]!;
    const abbr = (i: number) => cell(i).querySelector('[aria-hidden="true"]');
    expect(abbr(0)?.textContent).toBe("Fil:");
    expect(abbr(1)?.textContent).toBe("Eng:");
    expect(cell(0).querySelector(".sr-only")?.textContent).toBe("Filipino:");
    expect(cell(1).querySelector(".sr-only")?.textContent).toBe("English:");
  });

  it("shows long remarks in full instead of truncating them", () => {
    const remarks = "Reads two-syllable words with support; needs daily practice at home.";
    renderTable([makeRow({ id: "a", remarks })]);
    const [, first] = screen.getAllByRole("row");
    const remarksCell = within(first!).getAllByRole("cell")[7]!;
    expect(remarksCell.textContent).toBe(remarks);
    expect(remarksCell.querySelector(".truncate")).toBeNull();
  });
});
