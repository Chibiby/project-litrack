import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { exportSummary, toast } = vi.hoisted(() => ({
  exportSummary: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/actions/summary-export", () => ({ exportSummary }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  unstable_isUnrecognizedActionError: () => false,
}));

import { SummaryExportMenu } from "@/components/summary/summary-export-menu";

beforeAll(() => {
  // Radix Select needs these in jsdom.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
  // The menu's own download helper builds an object URL; jsdom has none.
  URL.createObjectURL ??= () => "blob:test";
  URL.revokeObjectURL ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  await screen.findByRole("button", { name: "Download" });
}

describe("SummaryExportMenu", () => {
  it("defaults to PDF and offers no layout choice", async () => {
    render(<SummaryExportMenu facetId="aral-teachers" request={{ level: "overall" }} />);
    await openPopover();
    expect(screen.getByRole("combobox", { name: "Format" }).textContent).toContain("PDF (.pdf)");
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("downloads a PDF when Download is pressed without changing anything", async () => {
    exportSummary.mockResolvedValue({ ok: true, data: { base64: "AA==", filename: "x.pdf" } });
    render(<SummaryExportMenu facetId="aral-teachers" request={{ level: "overall" }} />);
    await openPopover();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(exportSummary).toHaveBeenCalledTimes(1));
    expect(exportSummary.mock.calls[0]![0]).toMatchObject({
      facet: "aral-teachers",
      format: "PDF",
      purpose: "PRINT",
    });
  });

  it("still offers Excel", async () => {
    render(<SummaryExportMenu facetId="aral-teachers" request={{ level: "overall" }} />);
    await openPopover();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Format" }), { key: "Enter" });
    expect(await screen.findByRole("option", { name: "Excel (.xlsx)" })).toBeTruthy();
  });
});
