import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { saveMosyDecision, toast } = vi.hoisted(() => ({
  saveMosyDecision: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/actions/aral-mosy", () => ({ saveMosyDecision }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { MosyDecisionDialog } from "@/components/aral/mosy-decision-dialog";
import type { MosyRow } from "@/lib/aral/mosy-queries";
import { ARAL_MOSY_OUTCOME_CHOICE_LABELS } from "@/lib/constants/enum-labels";

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

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
    levelOptions: [{ value: "LOW_EMERGENT", label: "Low Emergent" }],
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

describe("MosyDecisionDialog", () => {
  it("has a neutral title", () => {
    render(<MosyDecisionDialog state={{ row: makeRow({}) }} onClose={() => {}} />);
    expect(screen.getByRole("heading", { name: "MOSY decision for Ana Cruz" })).not.toBeNull();
    expect(screen.queryByText("Move out from ARAL?")).toBeNull();
  });

  it("names the language of the MOSY reading level", () => {
    const { unmount } = render(
      <MosyDecisionDialog state={{ row: makeRow({}) }} onClose={() => {}} />
    );
    expect(screen.getByText("MOSY reading level (English)")).not.toBeNull();
    unmount();
    render(
      <MosyDecisionDialog
        state={{ row: makeRow({ gradeType: "G1", mosyLanguage: "FILIPINO" }) }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("MOSY reading level (Filipino)")).not.toBeNull();
  });

  it("submit button follows the choice", () => {
    render(<MosyDecisionDialog state={{ row: makeRow({}) }} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: "Save MOSY decision" })).not.toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Move out learner from ARAL/ }));
    expect(screen.getByRole("button", { name: "Move out learner" })).not.toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: /Stay as ARAL learner/ }));
    expect(screen.getByRole("button", { name: "Keep in ARAL" })).not.toBeNull();
  });
});

const WARNING = "You will become this learner's ARAL teacher";

describe("MosyDecisionDialog — Stay on a moved-out learner", () => {
  it("warns that the adviser becomes the ARAL teacher", async () => {
    const row = makeRow({ isAralLearner: false, status: "moved_out", decision: "MOVE_OUT" });
    render(<MosyDecisionDialog state={{ row }} onClose={() => {}} />);
    expect(screen.queryByText(WARNING)).toBeNull();

    fireEvent.click(await screen.findByRole("radio", { name: new RegExp(`^${ARAL_MOSY_OUTCOME_CHOICE_LABELS.STAY}`) }));
    expect(await screen.findByText(WARNING)).toBeTruthy();
  });

  it("shows no warning for a learner who is still in ARAL", async () => {
    render(<MosyDecisionDialog state={{ row: makeRow({}) }} onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("radio", { name: new RegExp(`^${ARAL_MOSY_OUTCOME_CHOICE_LABELS.STAY}`) }));
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});
