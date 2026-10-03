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
    levelOptionsByDecision: {
      STAY: [{ value: "LOW_EMERGENT", label: "Low Emergent" }],
      MOVE_OUT: [{ value: "DEVELOPING", label: "Developing" }],
      NONE: [{ value: "LOW_EMERGENT", label: "Low Emergent" }],
      TRANSFERRED_OUT: [
        { value: "LOW_EMERGENT", label: "Low Emergent" },
        { value: "DEVELOPING", label: "Developing" },
      ],
    },
    reasonChoices: [],
    mosyLevel: null,
    mosyLevelLabel: null,
    mosyLanguage: "ENGLISH",
    decision: null,
    reason: null,
    improvedToLevel: null,
    reasonLabel: null,
    remarks: null,
    bosyLevel: null,
    ...overrides,
  };
}

const LEVELS_BY_DECISION: MosyRow["levelOptionsByDecision"] = {
  STAY: [
    { value: "LOW_EMERGENT", label: "Low Emergent" },
    { value: "HIGH_EMERGENT", label: "High Emergent" },
  ],
  MOVE_OUT: [
    { value: "DEVELOPING", label: "Developing" },
    { value: "TRANSITIONING", label: "Transitioning" },
  ],
  NONE: [
    { value: "LOW_EMERGENT", label: "Low Emergent" },
    { value: "HIGH_EMERGENT", label: "High Emergent" },
  ],
  TRANSFERRED_OUT: [
    { value: "LOW_EMERGENT", label: "Low Emergent" },
    { value: "HIGH_EMERGENT", label: "High Emergent" },
    { value: "DEVELOPING", label: "Developing" },
    { value: "TRANSITIONING", label: "Transitioning" },
  ],
};

const REASON_CHOICES: MosyRow["reasonChoices"] = [
  {
    key: "IMPROVED_READING_LEVEL:DEVELOPING",
    reason: "IMPROVED_READING_LEVEL",
    improvedToLevel: "DEVELOPING",
    label: "Improved to Developing",
  },
  {
    key: "IMPROVED_READING_LEVEL:TRANSITIONING",
    reason: "IMPROVED_READING_LEVEL",
    improvedToLevel: "TRANSITIONING",
    label: "Improved to Transitioning",
  },
  {
    key: "DIAGNOSED_LSEN",
    reason: "DIAGNOSED_LSEN",
    improvedToLevel: null,
    label: "Diagnosed LSEN",
  },
  {
    key: "TRANSFERRED_OUT",
    reason: "TRANSFERRED_OUT",
    improvedToLevel: null,
    label: "Transferred out",
  },
];

const splitRow = (overrides: Partial<MosyRow> = {}) =>
  makeRow({ levelOptionsByDecision: LEVELS_BY_DECISION, reasonChoices: REASON_CHOICES, ...overrides });

function openSelect(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

function optionNames() {
  return screen.queryAllByRole("option").map((o) => o.textContent);
}

function pick(trigger: HTMLElement, name: string) {
  openSelect(trigger);
  fireEvent.click(screen.getByRole("option", { name }));
}

const levelTrigger = () => screen.getByRole("combobox", { name: /MOSY reading level/ });
const reasonTrigger = () => screen.getByRole("combobox", { name: /Select reason/ });

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

describe("MosyDecisionDialog level options follow the decision", () => {
  it("offers only the levels valid for the chosen decision", () => {
    render(<MosyDecisionDialog state={{ row: splitRow() }} onClose={() => {}} />);
    openSelect(levelTrigger());
    expect(optionNames()).toEqual(["Low Emergent", "High Emergent"]);
    cleanup();

    render(<MosyDecisionDialog state={{ row: splitRow() }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Move out learner from ARAL/ }));
    openSelect(levelTrigger());
    expect(optionNames()).toEqual(["Developing", "Transitioning"]);
  });

  it("clears a chosen level that the new decision does not allow, without picking another", () => {
    render(<MosyDecisionDialog state={{ row: splitRow() }} onClose={() => {}} />);
    pick(levelTrigger(), "Low Emergent");
    expect(levelTrigger().textContent).toBe("Low Emergent");

    fireEvent.click(screen.getByRole("radio", { name: /Move out learner from ARAL/ }));
    expect(levelTrigger().textContent).toBe("Select level");
  });

  it("keeps a chosen level that the new decision still allows", () => {
    const row = splitRow({
      levelOptionsByDecision: {
        ...LEVELS_BY_DECISION,
        STAY: [{ value: "DEVELOPING", label: "Developing" }],
      },
    });
    render(<MosyDecisionDialog state={{ row }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Stay as ARAL learner/ }));
    pick(levelTrigger(), "Developing");
    fireEvent.click(screen.getByRole("radio", { name: /Move out learner from ARAL/ }));
    expect(levelTrigger().textContent).toBe("Developing");
  });

  it("starts empty with a helper when the saved level is not valid for the saved decision", () => {
    const row = splitRow({
      isAralLearner: false,
      decision: "MOVE_OUT",
      mosyLevel: "NON_DECODER_LOW_EMERGENT",
      mosyLevelLabel: "Low Emergent",
    });
    render(<MosyDecisionDialog state={{ row }} onClose={() => {}} />);
    expect(levelTrigger().textContent).toBe("Select level");
    expect(
      screen.getByText(/The saved level Low Emergent is no longer an option for this decision/)
    ).not.toBeNull();
    pick(levelTrigger(), "Developing");
    expect(screen.queryByText(/is no longer an option for this decision/)).toBeNull();
  });

  it("starts empty with a helper when the saved reason is not offered", () => {
    const row = splitRow({
      isAralLearner: false,
      decision: "MOVE_OUT",
      mosyLevel: "DEVELOPING",
      mosyLevelLabel: "Developing",
      reason: "IMPROVED_EARLY_GRADES",
      reasonLabel: "Improved to a higher level",
    });
    render(<MosyDecisionDialog state={{ row }} onClose={() => {}} />);
    expect(levelTrigger().textContent).toBe("Developing");
    expect(reasonTrigger().textContent).toBe("Select reason");
    expect(screen.getByText(/The saved reason Improved to a higher level is no longer an option/)).not.toBeNull();
  });
});

describe("MosyDecisionDialog Improved reason and level stay in sync", () => {
  function renderMoveOut() {
    render(<MosyDecisionDialog state={{ row: splitRow() }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Move out learner from ARAL/ }));
  }

  it("sets the level when an Improved reason is picked", () => {
    renderMoveOut();
    pick(reasonTrigger(), "Improved to Transitioning");
    expect(levelTrigger().textContent).toBe("Transitioning");
  });

  it("switches the reason to the matching Improved choice when the level changes", () => {
    renderMoveOut();
    pick(reasonTrigger(), "Improved to Transitioning");
    pick(levelTrigger(), "Developing");
    expect(reasonTrigger().textContent).toBe("Improved to Developing");
  });

  it("clears the reason when no Improved choice matches the new level", () => {
    const row = splitRow({
      reasonChoices: REASON_CHOICES.filter((c) => c.improvedToLevel !== "DEVELOPING"),
    });
    render(<MosyDecisionDialog state={{ row }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Move out learner from ARAL/ }));
    pick(reasonTrigger(), "Improved to Transitioning");
    pick(levelTrigger(), "Developing");
    expect(reasonTrigger().textContent).toBe("Select reason");
  });

  it("leaves the level alone when an LSEN reason is picked or the level changes", () => {
    renderMoveOut();
    pick(levelTrigger(), "Developing");
    pick(reasonTrigger(), "Diagnosed LSEN");
    expect(levelTrigger().textContent).toBe("Developing");
    pick(levelTrigger(), "Transitioning");
    expect(reasonTrigger().textContent).toBe("Diagnosed LSEN");
  });
});

describe("MosyDecisionDialog Transferred out", () => {
  function renderMoveOut(row = splitRow()) {
    render(<MosyDecisionDialog state={{ row }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Move out learner from ARAL/ }));
  }

  it("puts the reason field before the level field when moving out", () => {
    renderMoveOut();
    const after = reasonTrigger().compareDocumentPosition(levelTrigger());
    expect(after & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no reason field for a Stay decision", () => {
    render(<MosyDecisionDialog state={{ row: splitRow() }} onClose={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: /Stay as ARAL learner/ }));
    expect(screen.queryByRole("combobox", { name: /Select reason/ })).toBeNull();
    expect(levelTrigger()).not.toBeNull();
  });

  it("widens the level list to include a Stay level", () => {
    renderMoveOut();
    openSelect(levelTrigger());
    expect(optionNames()).toEqual(["Developing", "Transitioning"]);
    cleanup();

    renderMoveOut();
    pick(reasonTrigger(), "Transferred out");
    openSelect(levelTrigger());
    expect(optionNames()).toEqual([
      "Low Emergent",
      "High Emergent",
      "Developing",
      "Transitioning",
    ]);
  });

  it("keeps the level when switching to Transferred out", () => {
    renderMoveOut();
    pick(levelTrigger(), "Developing");
    pick(reasonTrigger(), "Transferred out");
    expect(levelTrigger().textContent).toBe("Developing");
  });

  it("clears a Stay level when switching back to an LSEN reason", () => {
    renderMoveOut();
    pick(reasonTrigger(), "Transferred out");
    pick(levelTrigger(), "Low Emergent");
    pick(reasonTrigger(), "Diagnosed LSEN");
    expect(levelTrigger().textContent).toBe("Select level");
  });

  it("opens a saved Transferred out row with its level intact", () => {
    const row = splitRow({
      isAralLearner: false,
      decision: "MOVE_OUT",
      mosyLevel: "NON_DECODER_LOW_EMERGENT",
      mosyLevelLabel: "Low Emergent",
      reason: "TRANSFERRED_OUT",
      reasonLabel: "Transferred out",
      levelOptionsByDecision: {
        ...LEVELS_BY_DECISION,
        TRANSFERRED_OUT: [
          { value: "NON_DECODER_LOW_EMERGENT", label: "Low Emergent" },
          { value: "DEVELOPING", label: "Developing" },
        ],
      },
    });
    render(<MosyDecisionDialog state={{ row }} onClose={() => {}} />);
    expect(levelTrigger().textContent).toBe("Low Emergent");
    expect(reasonTrigger().textContent).toBe("Transferred out");
    expect(screen.queryByText(/no longer an option/)).toBeNull();
  });
});

const WARNING ="You will become this learner's ARAL teacher";

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
