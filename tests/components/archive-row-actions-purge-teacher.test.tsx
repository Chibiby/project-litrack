import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ArchivedTeacherRow } from "@/lib/admin/archive";

/**
 * Permanent delete of a teacher can succeed on the record while the Supabase
 * sign-in account survives (`authDeleted: false`). The toast must not claim a
 * clean delete in that case.
 */

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
const purgeRemovedTeacher = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/lib/actions/admin-archive", () => ({
  restoreRemovedLearner: vi.fn(),
  purgeRemovedLearner: vi.fn(),
  restoreRemovedTeacher: vi.fn(),
  purgeRemovedTeacher,
}));

const { TeacherRowActions } = await import("@/components/admin/archive-row-actions");

const teacher = {
  id: "t-1",
  fullName: "Ana Reyes",
  schoolDeleted: false,
} as unknown as ArchivedTeacherRow;

async function purge() {
  render(<TeacherRowActions teacher={teacher} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete Ana Reyes permanently" }));
  fireEvent.click(await screen.findByRole("button", { name: "Delete permanently" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("TeacherRowActions — permanent delete toast", () => {
  it("confirms a clean delete when the sign-in account was removed", async () => {
    purgeRemovedTeacher.mockResolvedValue({ ok: true, authDeleted: true });
    await purge();
    await waitFor(() =>
      expect(toastMock.success).toHaveBeenCalledWith("Ana Reyes's account permanently deleted.")
    );
    expect(toastMock.warning).not.toHaveBeenCalled();
  });

  it("warns when the record was deleted but the sign-in account was not", async () => {
    purgeRemovedTeacher.mockResolvedValue({ ok: true, authDeleted: false });
    await purge();
    await waitFor(() => expect(toastMock.warning).toHaveBeenCalledTimes(1));
    const message = String(toastMock.warning.mock.calls[0][0]);
    expect(message).toContain("Ana Reyes");
    expect(message).toMatch(/sign-in account could not be removed/i);
    expect(message).toMatch(/error log/i);
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});
