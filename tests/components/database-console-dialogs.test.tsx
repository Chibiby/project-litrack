import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting or restoring a stored backup used to go through `window.confirm` /
 * `window.prompt`. Both now open an app dialog that names the backup, and the
 * action only runs after the person confirms.
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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const ok = { ok: true as const };
const removeBackup = vi.fn(async (_fd: FormData) => ok);
const restoreFromBackup = vi.fn(async (_fd: FormData) => ok);
vi.mock("@/lib/actions/database", () => ({
  createBackupNow: vi.fn(),
  removeAllTeachers: vi.fn(),
  removeBackup: (fd: FormData) => removeBackup(fd),
  resetAllSchoolAccounts: vi.fn(),
  resetOperationalData: vi.fn(),
  restoreFromBackup: (fd: FormData) => restoreFromBackup(fd),
  restoreFromUpload: vi.fn(),
  undoLastOperation: vi.fn(),
}));

const { DatabaseConsole } = await import("@/components/admin/database-console");
const { CONFIRM_PHRASES } = await import("@/lib/constants/confirm-phrases");

const BACKUP = {
  kind: "daily" as const,
  pathname: "backups/daily/2026-09-29.json.gz",
  stamp: "2026-09-29",
  size: 2048,
  uploadedAt: "2026-09-29T00:00:00.000Z",
};

const DATA = {
  storeReady: true,
  storeMessage: "",
  backups: [BACKUP],
  safety: null,
  counts: {},
  totalRows: 0,
  accounts: { schoolHeads: 0, teachers: 0 },
  schools: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm");
  vi.spyOn(window, "prompt");
});

afterEach(cleanup);

describe("DatabaseConsole — backup dialogs", () => {
  it("delete opens a dialog naming the backup and only calls the action on confirm", async () => {
    render(<DatabaseConsole data={DATA} />);

    fireEvent.click(screen.getByRole("button", { name: /Delete the daily backup/ }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Delete the daily backup from/)).not.toBeNull();
    expect(within(dialog).getByText(/deleted permanently/)).not.toBeNull();
    expect(removeBackup).not.toHaveBeenCalled();
    expect(window.confirm).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete backup" }));

    await waitFor(() => expect(removeBackup).toHaveBeenCalledTimes(1));
    const fd = removeBackup.mock.calls[0]![0] as FormData;
    expect(fd.get("pathname")).toBe(BACKUP.pathname);
  });

  it("cancelling the delete dialog never calls the action", async () => {
    render(<DatabaseConsole data={DATA} />);
    fireEvent.click(screen.getByRole("button", { name: /Delete the daily backup/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(removeBackup).not.toHaveBeenCalled();
  });

  it("restore needs the typed phrase before 'Restore this backup' is enabled", async () => {
    render(<DatabaseConsole data={DATA} />);

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(window.prompt).not.toHaveBeenCalled();
    const confirmButton = within(dialog).getByRole("button", { name: "Restore this backup" });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: CONFIRM_PHRASES.restore },
    });
    expect((confirmButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirmButton);

    await waitFor(() => expect(restoreFromBackup).toHaveBeenCalledTimes(1));
    const fd = restoreFromBackup.mock.calls[0]![0] as FormData;
    expect(fd.get("pathname")).toBe(BACKUP.pathname);
    expect(fd.get("confirm")).toBe(CONFIRM_PHRASES.restore);
  });

  it("disables the row's Restore and Delete buttons while a restore is running", async () => {
    let finish: () => void = () => {};
    restoreFromBackup.mockImplementationOnce(
      () => new Promise<typeof ok>((resolve) => { finish = () => resolve(ok); })
    );
    render(<DatabaseConsole data={DATA} />);

    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByRole("textbox"), {
      target: { value: CONFIRM_PHRASES.restore },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Restore this backup" }));

    await waitFor(() => expect(restoreFromBackup).toHaveBeenCalledTimes(1));
    const rowRestore = screen.getByRole("button", { name: "Restore", hidden: true });
    const rowDelete = screen.getByRole("button", { name: /Delete the daily backup/, hidden: true });
    expect((rowRestore as HTMLButtonElement).disabled).toBe(true);
    expect((rowDelete as HTMLButtonElement).disabled).toBe(true);
    finish();
  });

  it("disables the row's Restore and Delete buttons while a delete is running", async () => {
    let finish: () => void = () => {};
    removeBackup.mockImplementationOnce(
      () => new Promise<typeof ok>((resolve) => { finish = () => resolve(ok); })
    );
    render(<DatabaseConsole data={DATA} />);

    fireEvent.click(screen.getByRole("button", { name: /Delete the daily backup/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete backup" }));

    await waitFor(() => expect(removeBackup).toHaveBeenCalledTimes(1));
    const rowRestore = screen.getByRole("button", { name: "Restore", hidden: true });
    const rowDelete = screen.getByRole("button", { name: /Delete the daily backup/, hidden: true });
    await waitFor(() => expect((rowRestore as HTMLButtonElement).disabled).toBe(true));
    expect((rowDelete as HTMLButtonElement).disabled).toBe(true);
    finish();
  });
});
