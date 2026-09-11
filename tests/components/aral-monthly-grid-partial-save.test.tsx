import { useRef } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The monthly reading-level grid used to refuse the WHOLE save if a single row
 * was half-filled. `bulkRecordMonthlyReadingLevel` now accepts a partial row as
 * long as it isn't entirely empty, and takes a separate `clears` array for a row
 * a teacher emptied on purpose. This proves:
 *   - a partial row posts, with its unset fields simply absent (not refused)
 *   - a partial row and a complete row on the same page both post
 *   - clearing a row that HAD a stored record posts its id in `clears`, not `entries`
 *   - clearing a row that never had a record posts it in neither array
 *   - a learner id never appears in both arrays
 *   - with nothing to send, the action is never called
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const bulkRecordMonthlyReadingLevel = vi.fn(async (_input?: unknown) => ({
  ok: true,
  data: { upserted: 1, cleared: 0 },
}));
vi.mock("@/lib/actions/reading-level", () => ({
  bulkRecordMonthlyReadingLevel: (...args: unknown[]) =>
    bulkRecordMonthlyReadingLevel(...(args as [])),
}));

const toastFn = vi.fn() as unknown as typeof import("sonner").toast & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  loading: ReturnType<typeof vi.fn>;
};
toastFn.success = vi.fn();
toastFn.error = vi.fn();
toastFn.loading = vi.fn(() => "toast-1");
vi.mock("sonner", () => ({ toast: toastFn }));

const {
  AralMonthlyReadingLevelGridForm,
} = await import("@/components/forms/aral-monthly-reading-level-grid-form");
const { toast } = await import("sonner");

import type {
  AralMonthlyReadingLevelGridFormHandle,
  MonthlyReadingLevelGridExisting,
  MonthlyReadingLevelGridLearner,
} from "@/components/forms/aral-monthly-reading-level-grid-form";

const MONTH_START = "2026-09-01";

const LEARNERS: MonthlyReadingLevelGridLearner[] = [
  { id: "learner-1", fullName: "Ana Santos" },
  { id: "learner-2", fullName: "Ben Cruz" },
];

/** Ana has a stored record; Ben never had one. */
const EXISTING: MonthlyReadingLevelGridExisting[] = [
  {
    learnerId: "learner-1",
    englishProfile: "INSTRUCTIONAL_DEVELOPING",
    filipinoProfile: "INDEPENDENT_GRADE_READY",
    wordRecognitionLevel: "LEVEL_3",
    readingComprehensionLevel: "LEVEL_2",
    writingLevel: null,
    notes: null,
  },
];

function Harness({ existing = EXISTING }: { existing?: MonthlyReadingLevelGridExisting[] }) {
  const formRef = useRef<AralMonthlyReadingLevelGridFormHandle>(null);
  return (
    <>
      <button type="button" onClick={() => formRef.current?.save()}>
        Save
      </button>
      <AralMonthlyReadingLevelGridForm
        ref={formRef}
        monthStartKey={MONTH_START}
        gradeType="G3"
        learners={LEARNERS}
        existing={existing}
      />
    </>
  );
}

function rowFor(name: string): HTMLElement {
  const cell = screen.getByText(name);
  const row = cell.closest("tr");
  if (!row) throw new Error(`No row for ${name}`);
  return row;
}

/** Opens a learner's English band picker and selects one option by its code. */
async function pickEnglish(learnerName: string, code: string) {
  fireEvent.click(
    within(rowFor(learnerName)).getByRole("button", {
      name: `${learnerName} — English reading level`,
    })
  );
  const listbox = await screen.findByRole("listbox", {
    name: `${learnerName} — English reading level`,
  });
  fireEvent.click(within(listbox).getByText(code));
}

async function clearRow(learnerName: string) {
  // Radix's DropdownMenuTrigger opens on pointerdown (and Enter/Space), not on
  // a plain click event — jsdom's fireEvent.click never fires a pointerdown.
  fireEvent.keyDown(
    within(rowFor(learnerName)).getByRole("button", {
      name: `Actions for ${learnerName}`,
    }),
    { key: "Enter" }
  );
  const menu = await screen.findByRole("menu");
  fireEvent.click(within(menu).getByText("Clear row"));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  bulkRecordMonthlyReadingLevel.mockResolvedValue({
    ok: true,
    data: { upserted: 1, cleared: 0 },
  });
});

afterEach(cleanup);

describe("monthly reading-level grid — partial save", () => {
  it("posts a row with only English set as one entry, other fields absent, with no refusal toast", async () => {
    render(<Harness existing={[]} />);

    // Grade Ready = "GR" on the K-3 label set.
    await pickEnglish("Ana Santos", "GR");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(bulkRecordMonthlyReadingLevel).toHaveBeenCalledTimes(1)
    );
    const payload = bulkRecordMonthlyReadingLevel.mock.calls[0][0] as {
      entries: Record<string, unknown>[];
      clears: string[];
    };
    expect(payload.entries).toEqual([
      {
        learnerId: "learner-1",
        englishProfile: "INDEPENDENT_GRADE_READY",
        filipinoProfile: undefined,
        wordRecognitionLevel: undefined,
        readingComprehensionLevel: undefined,
        writingLevel: undefined,
        notes: undefined,
      },
    ]);
    expect(payload.clears).toEqual([]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("posts both a partial row and a complete (existing) row on the same page", async () => {
    render(<Harness existing={EXISTING} />);

    await pickEnglish("Ben Cruz", "GR");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(bulkRecordMonthlyReadingLevel).toHaveBeenCalledTimes(1)
    );
    const payload = bulkRecordMonthlyReadingLevel.mock.calls[0][0] as {
      entries: { learnerId: string }[];
    };
    const ids = payload.entries.map((e) => e.learnerId).sort();
    expect(ids).toEqual(["learner-1", "learner-2"]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("posts a cleared row that HAD a stored record in clears, not entries", async () => {
    render(<Harness existing={EXISTING} />);

    await clearRow("Ana Santos");
    expect(toast.success).toHaveBeenCalledWith(
      "Row cleared. Save to keep the change."
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(bulkRecordMonthlyReadingLevel).toHaveBeenCalledTimes(1)
    );
    const payload = bulkRecordMonthlyReadingLevel.mock.calls[0][0] as {
      entries: { learnerId: string }[];
      clears: string[];
    };
    expect(payload.clears).toEqual(["learner-1"]);
    expect(payload.entries.some((e) => e.learnerId === "learner-1")).toBe(false);
  });

  it("posts a row that never had a record in neither array when cleared and saved", async () => {
    render(<Harness existing={EXISTING} />);

    await clearRow("Ben Cruz");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    // Ana's row is prefilled from `existing` and untouched, so it still posts as
    // an entry. Ben, who never had a record, must appear in neither array.
    await waitFor(() =>
      expect(bulkRecordMonthlyReadingLevel).toHaveBeenCalledTimes(1)
    );
    const payload = bulkRecordMonthlyReadingLevel.mock.calls[0][0] as {
      entries: { learnerId: string }[];
      clears: string[];
    };
    expect(payload.clears).not.toContain("learner-2");
    expect(payload.entries.some((e) => e.learnerId === "learner-2")).toBe(false);
  });

  it("never sends a learner id in both entries and clears", async () => {
    render(<Harness existing={EXISTING} />);

    // Ben gets a fresh value (an entry); Ana, who started with a stored record,
    // gets cleared (a clear). Every id must land in exactly one array.
    await pickEnglish("Ben Cruz", "GR");
    await clearRow("Ana Santos");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(bulkRecordMonthlyReadingLevel).toHaveBeenCalledTimes(1)
    );
    const payload = bulkRecordMonthlyReadingLevel.mock.calls[0][0] as {
      entries: { learnerId: string }[];
      clears: string[];
    };
    const entryIds = new Set(payload.entries.map((e) => e.learnerId));
    const clearIds = new Set(payload.clears);
    expect(entryIds.size).toBeGreaterThan(0);
    expect(clearIds.size).toBeGreaterThan(0);
    for (const id of entryIds) {
      expect(clearIds.has(id)).toBe(false);
    }
  });

  it("calls the action zero times when there is nothing to send", () => {
    render(<Harness existing={[]} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(bulkRecordMonthlyReadingLevel).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Nothing to save yet.");
  });

  it("posts a row saved-then-cleared in the same session as a clear, even before router.refresh() lands", async () => {
    // Ben has no stored record at all. The first save creates one; nothing
    // re-seeds `existing` in between (no new prop arrives, mirroring the gap
    // before `router.refresh()` resolves). The second save, which clears that
    // same row, must know it now has a record to delete.
    render(<Harness existing={[]} />);

    await pickEnglish("Ben Cruz", "GR");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(bulkRecordMonthlyReadingLevel).toHaveBeenCalledTimes(1)
    );

    await clearRow("Ben Cruz");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(bulkRecordMonthlyReadingLevel).toHaveBeenCalledTimes(2)
    );
    const secondPayload = bulkRecordMonthlyReadingLevel.mock.calls[1][0] as {
      entries: { learnerId: string }[];
      clears: string[];
    };
    expect(secondPayload.clears).toContain("learner-2");
    expect(
      secondPayload.entries.some((e) => e.learnerId === "learner-2")
    ).toBe(false);
  });
});
