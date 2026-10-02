import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/actions/reading-level", () => ({
  bulkRecordMonthlyReadingLevel: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => "t"),
  }),
}));

import {
  AralMonthlyReadingLevelGridForm,
  type MonthlyReadingLevelGridExisting,
  type MonthlyReadingLevelGridLearner,
} from "@/components/forms/aral-monthly-reading-level-grid-form";

const LEARNERS: MonthlyReadingLevelGridLearner[] = [
  { id: "l1", fullName: "Ana Santos", listingName: "Santos, Ana" },
];

function existing(profile: string): MonthlyReadingLevelGridExisting[] {
  return [
    {
      learnerId: "l1",
      englishProfile: profile,
      filipinoProfile: profile,
      wordRecognitionLevel: null,
      readingComprehensionLevel: null,
      writingLevel: null,
      notes: null,
    },
  ];
}

function renderGrid(gradeType: string, profile: string) {
  return render(
    <AralMonthlyReadingLevelGridForm
      monthStartKey="2026-09-01"
      gradeType={gradeType}
      learners={LEARNERS}
      existing={existing(profile)}
    />
  );
}

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("monthly reading-level grid — legacy Grade 1-3 level", () => {
  it("flags a legacy cell with text and a hint, not colour alone", () => {
    renderGrid("G2", "INSTRUCTIONAL_DEVELOPING");
    expect(screen.getAllByText("Needs update").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Choose Developing or Transitioning").length
    ).toBeGreaterThan(0);
    const trigger = screen.getByRole("button", {
      name: "Ana Santos — Filipino reading level — needs update",
    });
    expect(trigger.textContent).toContain("DT");
  });

  it("does not offer the legacy value, but offers Developing and Transitioning", async () => {
    renderGrid("G2", "INSTRUCTIONAL_DEVELOPING");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Ana Santos — Filipino reading level — needs update",
      })
    );
    const listbox = await screen.findByRole("listbox", {
      name: "Ana Santos — Filipino reading level",
    });
    const options = within(listbox).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining("Not assessed"),
      expect.stringContaining("LE"),
      expect.stringContaining("HE"),
      expect.stringContaining("DV"),
      expect.stringContaining("TR"),
      expect.stringContaining("GR"),
    ]);
    expect(within(listbox).queryByText(/needs update/i)).toBeNull();
  });

  it("shows no flag for Developing, and none on Grade 4 Instructional", () => {
    renderGrid("G2", "DEVELOPING");
    expect(screen.queryByText("Needs update")).toBeNull();
    cleanup();
    renderGrid("G5", "INSTRUCTIONAL_DEVELOPING");
    expect(screen.queryByText("Needs update")).toBeNull();
  });
});
