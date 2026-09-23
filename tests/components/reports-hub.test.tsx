import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

// Radix Select needs pointer-event APIs jsdom does not implement.
beforeAll(() => {
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
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

describe("ReportsHub export layout (Print/Records)", () => {
  it("generates with the default For-printing layout", async () => {
    renderHub();
    fireEvent.click(screen.getAllByRole("button", { name: /generate report/i })[0]!);
    await vi.waitFor(() => expect(generateReport).toHaveBeenCalled());
    expect(generateReport.mock.calls[0]![0]).toMatchObject({ purpose: "PRINT" });
  });

  it("sends RECORDS once For records is chosen", async () => {
    renderHub();
    fireEvent.click(screen.getByRole("radio", { name: /For records/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /generate report/i })[0]!);
    await vi.waitFor(() => expect(generateReport).toHaveBeenCalled());
    expect(generateReport.mock.calls[0]![0]).toMatchObject({ purpose: "RECORDS" });
  });

  it("disables the layout choice for PDF, which is always the print template", () => {
    renderHub();
    fireEvent.click(screen.getByRole("radio", { name: /For records/i }));

    fireEvent.click(screen.getByLabelText("Report Format"));
    fireEvent.click(screen.getByText("PDF (.pdf)"));

    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("still generates PDF as PRINT even if Records was chosen first", async () => {
    renderHub();
    fireEvent.click(screen.getByRole("radio", { name: /For records/i }));
    fireEvent.click(screen.getByLabelText("Report Format"));
    fireEvent.click(screen.getByText("PDF (.pdf)"));

    fireEvent.click(screen.getAllByRole("button", { name: /generate report/i })[0]!);
    await vi.waitFor(() => expect(generateReport).toHaveBeenCalled());
    expect(generateReport.mock.calls[0]![0]).toMatchObject({ format: "PDF", purpose: "PRINT" });
  });
});
