import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchoolDetail } from "@/lib/admin/school-detail";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, prefetch: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const toastFn = vi.fn() as unknown as typeof import("sonner").toast & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
};
toastFn.success = vi.fn();
toastFn.error = vi.fn();
toastFn.warning = vi.fn();
vi.mock("sonner", () => ({ toast: toastFn }));

const clearSchoolEverything = vi.fn();
vi.mock("@/lib/actions/database", () => ({
  clearSchoolEverything: (...args: unknown[]) => clearSchoolEverything(...args),
}));

const removeSchoolTeachers = vi.fn();
vi.mock("@/lib/actions/admin-school", () => ({
  removeSchoolLearners: vi.fn(),
  removeSchoolTeachers: (...args: unknown[]) => removeSchoolTeachers(...args),
}));

const { SchoolDetailView } = await import("@/components/admin/school-detail-view");

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

const DETAIL: SchoolDetail = {
  school: {
    id: "school-1",
    name: "Naidas T. Opong ES",
    schoolIdCode: "130554",
    address: null,
    region: null,
    division: null,
    district: null,
    isActive: true,
    isDemo: false,
    createdAt: "2024-01-01T00:00:00.000Z",
  },
  counts: { teachers: 1, learners: 0, sections: 0, gradeLevels: 0, schoolYears: 0 },
  teachers: [
    {
      id: "t1",
      fullName: "Juana Cruz",
      listingName: "Cruz, Juana",
      firstName: "Juana",
      lastName: "Cruz",
      email: "juana@school.local",
      isActive: true,
      approvalStatus: null,
      advisorySection: null,
      createdAt: "2024-01-01T00:00:00.000Z",
    },
  ],
  learners: [],
  learnerPage: 1,
  learnerPages: 1,
};

describe("SchoolDetailView — clear everything", () => {
  it("explains what Undo does and that it rolls back the whole database", () => {
    render(<SchoolDetailView detail={DETAIL} searchParams={{}} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Undo in the database console restores it");
    expect(text).toContain("rolls back the whole database");
    expect(text).toContain("other schools");
  });

  it("makes one clearSchoolEverything call and says it cannot be undone when not reversible", async () => {
    const { CONFIRM_PHRASES } = await import("@/lib/constants/confirm-phrases");
    clearSchoolEverything.mockResolvedValueOnce({
      ok: true,
      data: { removed: {}, teachersRemoved: 1, teachersFailed: 0, reversible: false },
    });
    render(<SchoolDetailView detail={DETAIL} searchParams={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear school" }));
    fireEvent.change(screen.getByLabelText(/to confirm/), {
      target: { value: CONFIRM_PHRASES.resetOperational },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Clear school" })[0]);

    await waitFor(() => expect(clearSchoolEverything).toHaveBeenCalledTimes(1));
    const fd = clearSchoolEverything.mock.calls[0][0] as FormData;
    expect(fd.get("schoolId")).toBe("school-1");
    expect(fd.get("confirm")).toBe(CONFIRM_PHRASES.resetOperational);
    await waitFor(() =>
      expect(toastFn.success).toHaveBeenCalledWith(
        expect.stringContaining("This cannot be undone")
      )
    );
  });

  it("warns, not celebrates, when some teacher accounts could not be removed", async () => {
    const { CONFIRM_PHRASES } = await import("@/lib/constants/confirm-phrases");
    clearSchoolEverything.mockResolvedValueOnce({
      ok: true,
      data: { removed: {}, teachersRemoved: 1, teachersFailed: 2, reversible: true },
    });
    render(<SchoolDetailView detail={DETAIL} searchParams={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear school" }));
    fireEvent.change(screen.getByLabelText(/to confirm/), {
      target: { value: CONFIRM_PHRASES.resetOperational },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Clear school" })[0]);

    await waitFor(() =>
      expect(toastFn.warning).toHaveBeenCalledWith(
        expect.stringContaining("2 teacher accounts could not be removed")
      )
    );
    expect(toastFn.success).not.toHaveBeenCalled();
  });

  it("says the records are gone and what to do next when the teacher step fails", async () => {
    const { CONFIRM_PHRASES } = await import("@/lib/constants/confirm-phrases");
    clearSchoolEverything.mockResolvedValueOnce({
      ok: true,
      data: {
        removed: {},
        teachersRemoved: 0,
        teachersFailed: 3,
        reversible: true,
        teacherStepFailed: true,
      },
    });
    render(<SchoolDetailView detail={DETAIL} searchParams={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear school" }));
    fireEvent.change(screen.getByLabelText(/to confirm/), {
      target: { value: CONFIRM_PHRASES.resetOperational },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Clear school" })[0]);

    await waitFor(() =>
      expect(toastFn.warning).toHaveBeenCalledWith(
        expect.stringContaining("Run Remove teachers from the database console")
      )
    );
    expect(toastFn.success).not.toHaveBeenCalled();
  });

  it("keeps the panel open with the typed phrase when the call fails", async () => {
    const { CONFIRM_PHRASES } = await import("@/lib/constants/confirm-phrases");
    clearSchoolEverything.mockResolvedValueOnce({
      ok: false,
      code: "DB_UNAVAILABLE",
      error: "Couldn't clear the school.",
    });
    render(<SchoolDetailView detail={DETAIL} searchParams={{}} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear school" }));
    const input = screen.getByLabelText(/to confirm/) as HTMLInputElement;
    fireEvent.change(input, { target: { value: CONFIRM_PHRASES.resetOperational } });
    fireEvent.click(screen.getAllByRole("button", { name: "Clear school" })[0]);

    await waitFor(() =>
      expect(toastFn.error).toHaveBeenCalledWith("Couldn't clear the school.", {
        id: "DB_UNAVAILABLE",
      })
    );
    expect(toastFn.success).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/to confirm/) as HTMLInputElement).value).toBe(
      CONFIRM_PHRASES.resetOperational
    );
  });
});

describe("SchoolDetailView — bulk teacher removal", () => {
  it("uses a warning toast naming the failures", async () => {
    removeSchoolTeachers.mockResolvedValueOnce({ ok: true, data: { removed: 1, failed: 2 } });
    render(<SchoolDetailView detail={DETAIL} searchParams={{}} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Remove Cruz, Juana" })[0]);

    await waitFor(() =>
      expect(toastFn.warning).toHaveBeenCalledWith(expect.stringContaining("2 could not be removed"))
    );
    expect(toastFn.success).not.toHaveBeenCalled();
  });
});
