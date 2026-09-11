import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The monthly reading-level panel used to describe every past month as "still
 * open for editing" no matter what. `readMonthlyReadingLevelLockState` now
 * gives it the program's real lock state, and `bulkRecordMonthlyReadingLevel`
 * enforces it server-side. This proves the panel reflects that state instead
 * of always claiming the month is open:
 *   - locking on, program switch off, month past its grace, not reopened for
 *     this teacher -> no Save control, "Locked" pill
 *   - same, but the month is in `unlockedMonths` -> Save renders, "Reopened"
 *     pill
 *   - the program-wide "unlock all" switch on -> Save renders even for a
 *     long-past month (today's shipping default)
 *   - locking switched off entirely -> Save renders
 *   - a month still inside its grace window -> Save renders regardless of
 *     the other flags
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const fetchAralReadingLevelForMonth = vi.fn();
vi.mock("@/lib/actions/aral-grid", () => ({
  fetchAralReadingLevelForMonth: (...args: unknown[]) =>
    fetchAralReadingLevelForMonth(...(args as [])),
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

const { AralMonthlyReadingLevelPanel } = await import(
  "@/components/aral/aral-monthly-reading-level-panel"
);

/** June 2026 — long past its July 7 grace deadline once "today" is September. */
const PAST_MONTH = "2026-06-01";
/** August 2026 — still inside its September 7 grace deadline on that same "today". */
const IN_GRACE_MONTH = "2026-08-01";

const LEARNERS = [{ id: "learner-1", fullName: "Ana Santos" }];

function renderPanel(overrides: Partial<React.ComponentProps<typeof AralMonthlyReadingLevelPanel>> = {}) {
  return render(
    <AralMonthlyReadingLevelPanel
      gradeId="grade-1"
      gradeType="G3"
      grades={[]}
      basePath="/teacher/aral/grade-1/reading-level"
      initialMonthKey={PAST_MONTH}
      section="all"
      sections={[]}
      showSection={false}
      gender="all"
      learners={LEARNERS}
      initialExisting={[]}
      initialProgress={{ completed: 0, total: 1 }}
      page={1}
      pageSize={20}
      totalPages={1}
      totalCount={1}
      lockingEnabled
      programUnlockAll={false}
      unlockedMonths={[]}
      {...overrides}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  // Fixed "today" so a month's grace window is deterministic: August 20,
  // 2026 puts June (PAST_MONTH) well past its July 7 deadline, but is still
  // short of August's (IN_GRACE_MONTH) September 7 deadline.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-20T04:00:00Z")); // ~noon Manila
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("monthly reading-level panel — lock state", () => {
  it("renders read-only with a Locked pill for a past month with no reopen grant", () => {
    renderPanel({
      initialMonthKey: PAST_MONTH,
      lockingEnabled: true,
      programUnlockAll: false,
      unlockedMonths: [],
    });

    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("Editing closed on July 7, 2026.")).toBeTruthy();
  });

  it("renders a Save control and a Reopened pill when the month is in unlockedMonths", () => {
    renderPanel({
      initialMonthKey: PAST_MONTH,
      lockingEnabled: true,
      programUnlockAll: false,
      unlockedMonths: [PAST_MONTH],
    });

    expect(screen.getByText("Reopened")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByText("Locked")).toBeNull();
  });

  it("renders a Save control for a long-past month when the program-wide unlock is on", () => {
    renderPanel({
      initialMonthKey: PAST_MONTH,
      lockingEnabled: true,
      programUnlockAll: true,
      unlockedMonths: [],
    });

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByText("Locked")).toBeNull();
  });

  it("renders a Save control when locking is switched off entirely", () => {
    renderPanel({
      initialMonthKey: PAST_MONTH,
      lockingEnabled: false,
      programUnlockAll: false,
      unlockedMonths: [],
    });

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByText("Locked")).toBeNull();
  });

  it("renders a Save control for a month still inside its grace window, regardless of flags", () => {
    renderPanel({
      initialMonthKey: IN_GRACE_MONTH,
      lockingEnabled: true,
      programUnlockAll: false,
      unlockedMonths: [],
    });

    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.queryByText("Locked")).toBeNull();
  });
});
