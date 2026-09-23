import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExportPurposeToggle,
  useExportPurpose,
} from "@/components/reports/export-purpose-toggle";

function Host() {
  const [purpose, setPurpose] = useExportPurpose();
  return (
    <div>
      <span data-testid="value">{purpose}</span>
      <ExportPurposeToggle value={purpose} onChange={setPurpose} />
    </div>
  );
}

afterEach(cleanup);
beforeEach(() => {
  window.localStorage.clear();
});

describe("ExportPurposeToggle", () => {
  it("defaults to For printing", () => {
    render(<Host />);
    expect(screen.getByTestId("value").textContent).toBe("PRINT");
    expect(
      (screen.getByRole("radio", { name: /For printing/i }) as HTMLInputElement).getAttribute(
        "data-state"
      )
    ).toBe("checked");
  });

  it("switching to For records updates the value and persists the choice", () => {
    render(<Host />);
    fireEvent.click(screen.getByRole("radio", { name: /For records/i }));
    expect(screen.getByTestId("value").textContent).toBe("RECORDS");
    expect(window.localStorage.getItem("litrack.exportPurpose")).toBe("RECORDS");
  });

  it("hides the built-in label when a caller already labels the control", () => {
    render(<ExportPurposeToggle value="PRINT" onChange={vi.fn()} hideLabel />);
    expect(screen.queryByText("Layout")).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Layout" })).toBeTruthy();
  });

  it("disables both options — used when the format is PDF, which is always the print layout", () => {
    render(<ExportPurposeToggle value="PRINT" onChange={vi.fn()} disabled />);
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("falls back to PRINT when localStorage throws on read", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Host />);
    expect(screen.getByTestId("value").textContent).toBe("PRINT");
    spy.mockRestore();
  });
});
