import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const { exportMosyReport, triggerDownload, toast } = vi.hoisted(() => ({
  exportMosyReport: vi.fn(),
  triggerDownload: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/actions/aral-mosy-export", () => ({ exportMosyReport }));
vi.mock("@/components/reports/trigger-download", () => ({ triggerDownload }));
vi.mock("sonner", () => ({ toast }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("q=ana&grade=g1&section=s2&status=PENDING"),
  unstable_isUnrecognizedActionError: () => false,
}));

import { MosyExportButton } from "@/components/aral/mosy-export-button";

beforeAll(() => {
  // Radix Select needs these in jsdom.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openPopover() {
  fireEvent.click(screen.getByRole("button", { name: "Export MOSY report" }));
  await screen.findByRole("button", { name: "Download" });
}

describe("MosyExportButton", () => {
  it("defaults to Excel with the printing layout", async () => {
    render(<MosyExportButton />);
    await openPopover();
    expect(screen.getByRole("combobox", { name: "Format" }).textContent).toContain(
      "Excel (.xlsx)",
    );
    expect(screen.getByRole("radio", { name: "For printing" }).getAttribute("data-state")).toBe(
      "checked",
    );
    expect((screen.getByRole("radio", { name: "For records" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("disables For records once PDF is chosen", async () => {
    render(<MosyExportButton />);
    await openPopover();
    fireEvent.click(screen.getByRole("radio", { name: "For records" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Format" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "PDF (.pdf)" }));
    await waitFor(() =>
      expect((screen.getByRole("radio", { name: "For records" }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect(screen.getByRole("radio", { name: "For printing" }).getAttribute("data-state")).toBe(
      "checked",
    );
  });

  it("sends format, purpose and the URL filters, then closes and toasts", async () => {
    let resolve!: (v: unknown) => void;
    exportMosyReport.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<MosyExportButton />);
    await openPopover();
    fireEvent.click(screen.getByRole("radio", { name: "For records" }));
    fireEvent.click(screen.getByRole("button", { name: "Download" }));

    const busyButton = await screen.findByRole("button", { name: "Preparing…" });
    expect((busyButton as HTMLButtonElement).disabled).toBe(true);
    const fd = exportMosyReport.mock.calls[0][0] as FormData;
    expect(fd.get("format")).toBe("EXCEL");
    expect(fd.get("purpose")).toBe("RECORDS");
    expect(fd.get("q")).toBe("ana");
    expect(fd.get("grade")).toBe("g1");
    expect(fd.get("section")).toBe("s2");
    expect(fd.get("status")).toBe("PENDING");

    resolve({ ok: true, data: { base64: "x", filename: "litrack-mosy-report.xlsx" } });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Downloaded litrack-mosy-report.xlsx"),
    );
    expect(triggerDownload).toHaveBeenCalledWith("x", "litrack-mosy-report.xlsx");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Download" })).toBeNull());
  });

  it("keeps the popover open and shows the error when the export fails", async () => {
    exportMosyReport.mockResolvedValue({ ok: false, error: "Nope" });
    render(<MosyExportButton />);
    await openPopover();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(toast.error.mock.calls.at(-1)?.[0]).toBe("Nope"));
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(triggerDownload).not.toHaveBeenCalled();
  });

  it("shows the connection message instead of a generic one when the request never lands", async () => {
    exportMosyReport.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<MosyExportButton />);
    await openPopover();
    fireEvent.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const message = String(toast.error.mock.calls.at(-1)?.[0]);
    expect(message).toMatch(/reach LITRACK|internet/i);
    expect(message).not.toMatch(/Could not export the MOSY report/);
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
  });
});
