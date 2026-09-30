import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `deleteSchool` is wrapped by `action()`, so a failure is RETURNED, not thrown.
 * The row must show that failure, keep the dialog open for a retry, and never
 * announce "School removed".
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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/schools",
  useSearchParams: () => new URLSearchParams(""),
  unstable_isUnrecognizedActionError: () => false,
}));

const toastFn = vi.fn() as unknown as typeof import("sonner").toast & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};
toastFn.success = vi.fn();
toastFn.error = vi.fn();
vi.mock("sonner", () => ({ toast: toastFn }));

const deleteSchool = vi.fn();
vi.mock("@/lib/actions/school", () => ({
  deleteSchool: (...args: unknown[]) => deleteSchool(...args),
  regenerateSchoolHeadCredential: vi.fn(),
}));

vi.mock("@/lib/actions/school-management", () => ({
  setSchoolActive: vi.fn(),
}));

const { SchoolsTable } = await import("@/components/schools-table");
type SchoolRowType = Parameters<typeof SchoolsTable>[0]["schools"][number];

const SCHOOL: SchoolRowType = {
  id: "school-1",
  name: "Naidas T. Opong ES",
  schoolIdCode: "130554",
  region: "NCR",
  division: "Manila",
  isActive: true,
  users: 5,
  learners: 40,
  isDemo: false,
};

const LIST = {
  page: 1,
  totalPages: 1,
  totalCount: 1,
  pageSize: 10,
  q: "",
  region: "",
  status: "" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

async function confirmRemove() {
  fireEvent.click(screen.getAllByRole("button", { name: `Remove ${SCHOOL.name}` })[0]);
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
}

describe("SchoolsTable — deleteSchool failure", () => {
  it("shows the returned failure, no success toast, and keeps the dialog open", async () => {
    deleteSchool.mockResolvedValueOnce({
      ok: false,
      code: "DB_UNAVAILABLE",
      error: "Couldn't remove the school: the database didn't respond in time.",
    });

    render(<SchoolsTable schools={[SCHOOL]} list={LIST} />);
    await confirmRemove();

    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith(
        "Couldn't remove the school: the database didn't respond in time.",
        { id: "DB_UNAVAILABLE" }
      )
    );
    expect(toastFn.success).not.toHaveBeenCalled();
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
  });

  it("toasts success only when deleteSchool resolves without a failure", async () => {
    deleteSchool.mockResolvedValueOnce(undefined);

    render(<SchoolsTable schools={[SCHOOL]} list={LIST} />);
    await confirmRemove();

    await waitFor(() => expect(toastFn.success).toHaveBeenCalledWith("School removed"));
    expect(toastFn.error).not.toHaveBeenCalled();
  });
});
