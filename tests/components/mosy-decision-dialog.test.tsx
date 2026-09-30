import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MosyRow } from "@/lib/aral/mosy-queries";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/actions/aral-mosy", () => ({ saveMosyDecision: vi.fn() }));

const { MosyDecisionDialog } = await import("@/components/aral/mosy-decision-dialog");

const ROW: MosyRow = {
  id: "learner-1",
  fullName: "Ana Reyes",
  gradeLevelId: "grade-1",
  gradeType: "GRADE_3",
  gradeLabel: "Grade 3",
  sectionName: "Sampaguita",
  isAralLearner: true,
  status: "PENDING" as MosyRow["status"],
  levelOptions: [{ value: "FRUSTRATION", label: "Frustration" }],
  reasonChoices: [],
  mosyLevel: null,
  mosyLevelLabel: null,
  decision: null,
  reason: null,
  improvedToLevel: null,
  reasonLabel: null,
  remarks: null,
  previousLevel: null,
};

afterEach(cleanup);

describe("MosyDecisionDialog", () => {
  it("has a neutral title and explains the move-out can be undone", () => {
    render(<MosyDecisionDialog state={{ row: ROW }} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "MOSY decision for Ana Reyes" })).not.toBeNull();
    expect(screen.queryByText("Move out from ARAL?")).toBeNull();
    expect(screen.getByText(/tutor who recorded it can reopen this dialog and\s+choose Stay/)).not.toBeNull();
  });

  it("submit button follows the choice", () => {
    render(<MosyDecisionDialog state={{ row: ROW }} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Save MOSY decision" })).not.toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Move out learner from ARAL/ }));
    expect(screen.getByRole("button", { name: "Move out learner" })).not.toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Stay as ARAL learner/ }));
    expect(screen.getByRole("button", { name: "Keep in ARAL" })).not.toBeNull();
  });
});
