import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Reports Hub: MOSY leads the cards, and a locked kind (per
 * `reportLocksFor`) renders disabled everywhere it can be picked — the card,
 * its Quick Generate chip — with the refusal sentence attached.
 *
 * This repo has no @testing-library/jest-dom — use native DOM assertions only.
 */

const generateReport = vi.fn(async (_input: unknown) => ({
  ok: true as const,
  data: undefined,
}));
const deleteReport = vi.fn(async (_input: unknown) => ({ ok: true as const }));
vi.mock("@/lib/actions/reports", () => ({
  generateReport: (input: unknown) => generateReport(input),
  deleteReport: (input: unknown) => deleteReport(input),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

const { ReportsHub } = await import("@/components/reports/reports-hub");

function renderHub(overrides: Partial<Parameters<typeof ReportsHub>[0]> = {}) {
  return render(
    <ReportsHub
      schoolYears={[]}
      grades={[]}
      sections={[]}
      recent={[]}
      canDelete
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("ReportsHub", () => {
  it("renders MOSY as the first card", () => {
    const { container } = renderHub();
    const titles = Array.from(
      container.querySelectorAll("p.font-semibold.leading-tight")
    ).map((el) => el.textContent);
    expect(titles[0]).toBe("MOSY Report");
  });

  it("disables the locked card and its quick chip, showing the reason", () => {
    renderHub({ locks: { TERM_GRADES: "x" } });

    const cardTitle = screen.getByText("End of Term Report (Grades)");
    const card = cardTitle.closest("[aria-disabled]");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("aria-disabled")).toBe("true");
    expect(card?.textContent).toContain("x");
    expect(card?.querySelector("button")).toBeNull();

    const chip = screen.getByRole("button", { name: /This Term Grades/i });
    expect((chip as HTMLButtonElement).disabled).toBe(true);
    expect(chip.getAttribute("title")).toBe("x");
  });

  it("leaves the card enabled with no locks", () => {
    renderHub();
    const cardTitle = screen.getByText("End of Term Report (Grades)");
    const card = cardTitle.closest("[aria-disabled]");
    expect(card).not.toBeNull();
    expect(card?.getAttribute("aria-disabled")).toBe("false");
    expect(card?.querySelector('button[type="button"]')).not.toBeNull();

    const chip = screen.getByRole("button", { name: /This Term Grades/i });
    expect((chip as HTMLButtonElement).disabled).toBe(false);
  });
});
