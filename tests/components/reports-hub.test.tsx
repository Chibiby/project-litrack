import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Reports page: one card per report with one Export control (the Division
 * Summary pattern: a popover with the report's real choices, then Download).
 * MOSY has no card (it exports from its own page; the kind stays so old history
 * rows download again), and a locked kind (per `reportLocksFor`) shows its
 * reason in place of the Export control.
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

function card(title: string): HTMLElement {
  const el = screen.getByRole("heading", { name: title }).closest("li");
  if (!el) throw new Error(`no card for ${title}`);
  return el as HTMLElement;
}

function openExport(title: string) {
  fireEvent.click(screen.getByRole("button", { name: `Export ${title}` }));
}

// Radix Select and Popover need pointer-event APIs jsdom does not implement.
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

describe("ReportsHub cards", () => {
  it("lists the five reports, with no MOSY and no unbuilt Custom card", () => {
    renderHub();
    const titles = screen
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(titles).toEqual([
      "Attendance",
      "Monthly Reading Level",
      "End of Term Grades",
      "Class Roster",
      "Class Summary",
      "Recent downloads",
    ]);
    expect(screen.queryByText(/MOSY/i)).toBeNull();
    expect(screen.queryByText(/Custom Report/i)).toBeNull();
  });

  it("REPORT_CARDS lists no MOSY, but the validator still accepts kind MOSY", async () => {
    const { REPORT_CARDS } = await import("@/lib/reports/kinds");
    expect(REPORT_CARDS.some((c) => c.kind === "MOSY")).toBe(false);
    const { reportGenerateSchema } = await import("@/lib/validators/report.schema");
    expect(reportGenerateSchema.safeParse({ kind: "MOSY", format: "EXCEL" }).success).toBe(true);
  });

  it("has no dead controls: no tabs, settings, guide or quick-generate row", () => {
    renderHub();
    for (const name of [/Report Settings/i, /View Guide/i, /All Reports/i, /This Week Attendance/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("shows the lock reason in place of the Export control", () => {
    renderHub({ locks: { TERM_GRADES: "x" } });
    const locked = card("End of Term Grades");
    expect(locked.getAttribute("aria-disabled")).toBe("true");
    expect(locked.textContent).toContain("x");
    expect(within(locked).queryByRole("button")).toBeNull();
    // The other cards keep theirs.
    expect(within(card("Attendance")).getByRole("button", { name: "Export Attendance" })).not.toBeNull();
  });

  it("says when a report was last downloaded", () => {
    renderHub({
      recent: [
        {
          id: "r1",
          name: "attendance.xlsx",
          kind: "ATTENDANCE",
          format: "EXCEL",
          scopeLabel: null,
          createdAt: "2026-11-13T02:00:00.000Z",
          createdByName: "Anna",
          filters: {},
        },
      ],
    });
    expect(card("Attendance").textContent).toMatch(/Last downloaded/);
    expect(card("Class Roster").textContent).toMatch(/Not downloaded yet/);
  });
});

describe("ReportsHub class filters", () => {
  it("shows no filter with only one possible answer", () => {
    renderHub({
      schoolYears: [{ id: "y1", label: "2026-2027" }],
      grades: [{ id: "g1", label: "Grade 1" }],
      sections: [{ id: "s1", label: "A", gradeLevelId: "g1" }],
    });
    expect(screen.queryByLabelText("School year")).toBeNull();
    expect(screen.queryByLabelText("Grade")).toBeNull();
    expect(screen.queryByLabelText("Section")).toBeNull();
  });

  it("shows Grade and Section when there is a choice, and names what is covered", () => {
    renderHub({
      grades: [
        { id: "g1", label: "Kinder" },
        { id: "g2", label: "Grade 1" },
      ],
      sections: [
        { id: "s1", label: "A", gradeLevelId: "g1" },
        { id: "s2", label: "B", gradeLevelId: "g2" },
      ],
    });
    expect(screen.getByLabelText("Grade")).not.toBeNull();
    expect(screen.getByLabelText("Section")).not.toBeNull();
    expect(screen.getByText("All your classes")).not.toBeNull();
    // Nothing narrowed yet, so there is nothing to clear.
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });
});

describe("ReportsHub export", () => {
  it("exports attendance for this month, in the printing layout, as Excel by default", async () => {
    renderHub();
    openExport("Attendance");
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await vi.waitFor(() => expect(generateReport).toHaveBeenCalled());
    const input = generateReport.mock.calls[0]![0] as Record<string, string>;
    expect(input).toMatchObject({ kind: "ATTENDANCE", format: "EXCEL", purpose: "PRINT" });
    expect(input.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(input.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("sends no dates for School year", async () => {
    renderHub();
    openExport("Attendance");
    fireEvent.click(screen.getByRole("button", { name: "School year" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await vi.waitFor(() => expect(generateReport).toHaveBeenCalled());
    expect(generateReport.mock.calls[0]![0]).toMatchObject({ from: null, to: null });
  });

  it("offers no period on a report that has no dates", () => {
    renderHub();
    openExport("Class Roster");
    expect(screen.queryByText("Period")).toBeNull();
    expect(screen.getByLabelText("Format")).not.toBeNull();
  });

  it("will not download custom dates until a date is picked", () => {
    renderHub();
    openExport("Attendance");
    fireEvent.click(screen.getByRole("button", { name: "Custom dates" }));
    const download = screen.getByRole("button", { name: "Download" }) as HTMLButtonElement;
    expect(download.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-02" } });
    expect((screen.getByRole("button", { name: "Download" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("exports PDF and remembers the choice", async () => {
    renderHub();
    openExport("Class Roster");
    fireEvent.click(screen.getByLabelText("Format"));
    fireEvent.click(screen.getByText("PDF (.pdf)"));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await vi.waitFor(() => expect(generateReport).toHaveBeenCalled());
    expect(generateReport.mock.calls[0]![0]).toMatchObject({
      kind: "CLASS_ROSTER",
      format: "PDF",
      purpose: "PRINT",
    });
    expect(window.localStorage.getItem("litrack.reports.format")).toBe("PDF");
  });

  it("offers no layout choice", () => {
    renderHub();
    openExport("Attendance");
    expect(screen.queryByRole("radio", { name: /For records/i })).toBeNull();
    expect(screen.queryByRole("radio", { name: /For printing/i })).toBeNull();
  });
});

describe("ReportsHub recent downloads", () => {
  const row = {
    id: "r1",
    name: "reading-level.pdf",
    kind: "READING_LEVEL" as const,
    format: "PDF" as const,
    scopeLabel: "Grade 1 - A",
    createdAt: "2026-11-13T02:00:00.000Z",
    createdByName: "Anna",
    filters: { from: "2026-11-01", to: "2026-11-30", sectionId: "s1" },
  };

  it("downloads a row again with its own format and choices", async () => {
    renderHub({ recent: [row] });
    const table = document.querySelector("table") as HTMLElement;
    fireEvent.click(within(table).getByRole("button", { name: "Download reading-level.pdf again" }));
    await vi.waitFor(() => expect(generateReport).toHaveBeenCalled());
    expect(generateReport.mock.calls[0]![0]).toMatchObject({
      kind: "READING_LEVEL",
      format: "PDF",
      from: "2026-11-01",
      to: "2026-11-30",
      sectionId: "s1",
    });
  });

  it("shows the period in words and no Generated By column", () => {
    renderHub({ recent: [row] });
    const table = document.querySelector("table") as HTMLElement;
    expect(table.textContent).toContain("Nov 1, 2026 to Nov 30, 2026");
    expect(within(table).queryByText("Generated By")).toBeNull();
  });

  it("says so when there is nothing yet", () => {
    renderHub();
    expect(screen.getByText(/No downloads yet/)).not.toBeNull();
  });
});
