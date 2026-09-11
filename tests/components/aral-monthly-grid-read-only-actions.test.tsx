import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression cover for a defect where the row-actions menu trigger picked up
 * `disabled={readOnly}`. That also blocked "View reading history" — the only
 * link from this grid to a learner's history — for a Super Admin viewing with
 * `?schoolId=` or a teacher on a locked month. The trigger must stay enabled
 * under `readOnly`; only "Clear row" (a real mutation) may disable.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/lib/actions/reading-level", () => ({
  bulkRecordMonthlyReadingLevel: vi.fn(async () => ({
    ok: true,
    data: { upserted: 0, cleared: 0 },
  })),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(() => "toast-1"),
  }),
}));

const {
  AralMonthlyReadingLevelGridForm,
} = await import("@/components/forms/aral-monthly-reading-level-grid-form");

import type {
  MonthlyReadingLevelGridExisting,
  MonthlyReadingLevelGridLearner,
} from "@/components/forms/aral-monthly-reading-level-grid-form";

const LEARNERS: MonthlyReadingLevelGridLearner[] = [
  { id: "learner-1", fullName: "Ana Santos" },
];

const EXISTING: MonthlyReadingLevelGridExisting[] = [];

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

describe("monthly reading-level grid — read-only row actions", () => {
  it("keeps the row-actions trigger enabled under readOnly, reaches the history link, and disables Clear row", async () => {
    render(
      <AralMonthlyReadingLevelGridForm
        monthStartKey="2026-09-01"
        gradeType="G3"
        learners={LEARNERS}
        existing={EXISTING}
        readOnly
        learnerHrefFor={(id) => `/school-head/learners/${id}/reading-history`}
      />
    );

    const trigger = screen.getByRole("button", { name: "Actions for Ana Santos" });
    // The regression: the trigger itself must not carry `disabled`.
    expect((trigger as HTMLButtonElement).disabled).toBe(false);

    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");

    const historyLink = within(menu).getByRole("menuitem", {
      name: "View reading history",
    });
    expect(historyLink.tagName).toBe("A");
    expect(historyLink.getAttribute("href")).toBe(
      "/school-head/learners/learner-1/reading-history"
    );
    expect(historyLink.getAttribute("aria-disabled")).not.toBe("true");

    const clearItem = within(menu).getByRole("menuitem", { name: /Clear row/ });
    expect(clearItem.getAttribute("aria-disabled")).toBe("true");
  });

  it("disables the trigger's own row actions on nothing else when not readOnly", async () => {
    render(
      <AralMonthlyReadingLevelGridForm
        monthStartKey="2026-09-01"
        gradeType="G3"
        learners={LEARNERS}
        existing={EXISTING}
        learnerHrefFor={(id) => `/school-head/learners/${id}/reading-history`}
      />
    );

    const trigger = screen.getByRole("button", { name: "Actions for Ana Santos" });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);

    fireEvent.keyDown(trigger, { key: "Enter" });
    const menu = await screen.findByRole("menu");
    const clearItem = within(menu).getByRole("menuitem", { name: /Clear row/ });
    expect(clearItem.getAttribute("aria-disabled")).not.toBe("true");
  });
});
