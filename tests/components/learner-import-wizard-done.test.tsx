import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const unparseResults: string[] = [];

vi.mock("papaparse", async () => {
  const actual = await vi.importActual<{ default: typeof import("papaparse") }>("papaparse");
  const parse = (
    _file: unknown,
    opts: { complete: (r: { data: Record<string, unknown>[]; errors: unknown[] }) => void }
  ) => {
    opts.complete({ data: [{ firstName: "A", lastName: "B" }], errors: [] });
  };
  const unparse = (data: unknown) => {
    const out = actual.default.unparse(data as never);
    unparseResults.push(out);
    return out;
  };
  return { default: { parse, unparse } };
});

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _p,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/ui/toast-failure", () => ({ toastFailure: vi.fn() }));

const skipped = [
  { rowNumber: 2, ok: false, errors: ["=HYPERLINK(\"x\")"], rawPreview: "+evil" },
  { rowNumber: 3, ok: false, errors: ["@bad", "-neg"], rawPreview: "Fine Name" },
];

vi.mock("@/lib/actions/import-learners", () => ({
  getLearnerImportTemplate: vi.fn(),
  previewLearnerImport: vi.fn(async () => ({
    ok: true,
    data: { results: skipped, summary: { valid: 0, invalid: 2, duplicateWarnings: 0 } },
  })),
  commitLearnerImport: vi.fn(async () => ({
    ok: true,
    data: { imported: 0, skippedInvalid: 2, skippedDuplicate: 0, results: skipped },
  })),
}));

import { LearnerImportWizard } from "@/components/learners/learner-import-wizard";

beforeEach(() => {
  unparseResults.length = 0;
  URL.createObjectURL = vi.fn(() => "blob:x");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});
afterEach(cleanup);

describe("LearnerImportWizard done step", () => {
  async function toDone() {
    const { previewLearnerImport } = await import("@/lib/actions/import-learners");
    (previewLearnerImport as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      data: {
        results: [
          { rowNumber: 1, ok: true, data: { firstName: "A", lastName: "B", age: 7 } },
          ...skipped,
        ],
        summary: { valid: 1, invalid: 2, duplicateWarnings: 0 },
      },
    });
    const { container } = render(<LearnerImportWizard gradeLevelId="g1" gradeLabel="Grade 1" />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.csv", { type: "text/csv" })] },
    });
    const importBtn = await screen.findByRole("button", { name: /Import 1 valid/ });
    await waitFor(() => expect((importBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(importBtn);
    await screen.findByRole("heading", { name: "Import complete" }, { timeout: 3000 });
  }

  it("guards every exported CSV cell against formula injection", async () => {
    await toDone();
    fireEvent.click(screen.getByRole("button", { name: /Download skipped rows/ }));
    const csv = unparseResults[0];
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'@bad; -neg");
    expect(csv).toContain("'+evil");
    expect(csv).not.toMatch(/(^|,|\n)"?[=+\-@]/);
  });

  it("names the skipped-rows table and moves focus to the summary heading", async () => {
    await toDone();
    const heading = screen.getByRole("heading", { name: "Import complete" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.getByRole("table", { name: /did not import/i })).toBeTruthy();
  });
});
