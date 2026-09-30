import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A bulk Danger-zone run that finished with some rows failing is a warning, not
 * a success: the toast names how many failed. A clean run stays a success.
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

const removeAllTeachers = vi.fn(async (_fd: FormData): Promise<unknown> => ({
  ok: true,
  data: { processed: 3, failed: 0 },
}));
vi.mock("@/lib/actions/database", () => ({
  createBackupNow: vi.fn(),
  removeAllTeachers: (fd: FormData) => removeAllTeachers(fd),
  removeBackup: vi.fn(),
  resetAllSchoolAccounts: vi.fn(),
  resetOperationalData: vi.fn(),
  restoreFromBackup: vi.fn(),
  restoreFromUpload: vi.fn(),
  undoLastOperation: vi.fn(),
}));

const { DatabaseConsole } = await import("@/components/admin/database-console");
const { CONFIRM_PHRASES } = await import("@/lib/constants/confirm-phrases");

const DATA = {
  storeReady: true,
  storeMessage: "",
  backups: [],
  safety: null,
  counts: {},
  totalRows: 0,
  accounts: { schoolHeads: 0, teachers: 4 },
  schools: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

async function runRemoveTeachers() {
  render(<DatabaseConsole data={DATA} />);
  fireEvent.click(screen.getByRole("button", { name: "Remove teachers" }));
  fireEvent.change(screen.getByLabelText(`Type ${CONFIRM_PHRASES.removeTeachers} to confirm`), {
    target: { value: CONFIRM_PHRASES.removeTeachers },
  });
  const buttons = screen.getAllByRole("button", { name: "Remove teachers" });
  fireEvent.click(buttons[buttons.length - 1]!);
  await waitFor(() => expect(removeAllTeachers).toHaveBeenCalledTimes(1));
}

describe("DatabaseConsole — partial failures", () => {
  it("warns with the failed count when some rows failed", async () => {
    removeAllTeachers.mockResolvedValueOnce({ ok: true, data: { processed: 3, failed: 1 } });
    await runRemoveTeachers();

    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledTimes(1));
    const message = toastMock.warning.mock.calls[0]![0] as string;
    expect(message).toContain("3 teacher accounts removed");
    expect(message).toContain("1 couldn't be removed");
    expect(message).toContain("error log");
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("stays a success when nothing failed", async () => {
    await runRemoveTeachers();

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(toastMock.success).toHaveBeenCalledWith("3 teacher accounts removed");
    expect(toastMock.warning).not.toHaveBeenCalled();
  });
});
