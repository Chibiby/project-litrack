import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearnerListRow } from "@/components/learners/learner-list-client";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/learners",
  useSearchParams: () => new URLSearchParams("filter=archived"),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/actions/learner-profile", () => ({ getLearnerProfile: vi.fn() }));
vi.mock("@/lib/actions/learner", () => ({
  deleteLearners: vi.fn(),
  archiveLearners: vi.fn(),
  restoreLearner: vi.fn(async () => ({ ok: true })),
  toggleAralLearner: vi.fn(),
  enrollRosterLearnersToAral: vi.fn(),
}));
vi.mock("@/lib/actions/aral-tutors", () => ({ listAralTutorOptions: vi.fn() }));
const purgeArchivedLearner = vi.fn();
vi.mock("@/lib/actions/learner-purge", () => ({
  purgeArchivedLearner: (fd: FormData) => purgeArchivedLearner(fd),
}));
vi.mock("@/components/nav-prefetcher", () => ({
  invalidateNavWarm: vi.fn(),
  NavPrefetcher: () => null,
}));
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
    loading: vi.fn(() => "t"),
  },
}));

const { LearnerListClient } = await import(
  "@/components/learners/learner-list-client"
);

const ROW: LearnerListRow = {
  id: "learner-1",
  fullName: "Ana Santos",
  listingName: "Santos, Ana",
  age: 10,
  gender: "FEMALE",
  isAralLearner: false,
  archivedAt: "2026-01-01T00:00:00.000Z",
  englishReadingProfile: "INSTRUCTIONAL_DEVELOPING",
  filipinoReadingProfile: "INDEPENDENT_GRADE_READY",
  section: { id: "sec-1", name: "Sampaguita" },
  gradeLevelId: "grade-g3",
  gradeType: "G3",
};

function renderRoster(archivedView: boolean, isSuperAdmin = false) {
  return render(
    <LearnerListClient
      gender="all"
      aralStatus="all"
      sections={[{ id: "sec-1", name: "Sampaguita" }]}
      isSuperAdmin={isSuperAdmin}
      learners={[archivedView ? ROW : { ...ROW, archivedAt: null }]}
      page={1}
      pageSize={10}
      totalCount={1}
      q=""
      archivedView={archivedView}
    />
  );
}

const REMOVE = { name: "Remove Ana Santos permanently" };

async function openDialog() {
  fireEvent.click(screen.getAllByRole("button", REMOVE)[0]);
  return screen.findByRole("alertdialog");
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("Remove archived learner", () => {
  it("is offered only in the archived view", () => {
    renderRoster(false);
    expect(screen.queryAllByRole("button", REMOVE)).toHaveLength(0);
    cleanup();
    renderRoster(true);
    expect(screen.getAllByRole("button", REMOVE).length).toBeGreaterThan(0);
  });

  it("keeps the confirm disabled until the typed name matches", async () => {
    renderRoster(true);
    const dialog = await openDialog();
    const input = dialog.querySelector("input") as HTMLInputElement;
    const confirm = screen.getByRole("button", { name: "Remove permanently" });

    expect(input.value).toBe("");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "Ana Sant" } });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(input, { target: { value: "  ana   SANTOS " } });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it("calls the action with id and typed name, then toasts and refreshes", async () => {
    purgeArchivedLearner.mockResolvedValue({ ok: true });
    renderRoster(true);
    const dialog = await openDialog();
    fireEvent.change(dialog.querySelector("input")!, {
      target: { value: "Ana Santos" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove permanently" }));

    await waitFor(() => expect(purgeArchivedLearner).toHaveBeenCalledTimes(1));
    const fd = purgeArchivedLearner.mock.calls[0][0] as FormData;
    expect(fd.get("id")).toBe("learner-1");
    expect(fd.get("confirmName")).toBe("Ana Santos");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1));
    expect(refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("stays open with the typed text, the field error and a toast when the server refuses", async () => {
    purgeArchivedLearner.mockResolvedValue({
      ok: false,
      code: "VALIDATION_FAILED",
      error: "Could not remove",
      fieldErrors: { confirmName: "Name does not match" },
    });
    renderRoster(true);
    const dialog = await openDialog();
    const input = dialog.querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Ana Santos" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove permanently" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(input.value).toBe("Ana Santos");
    expect(screen.getByText("Name does not match")).toBeTruthy();
  });

  it("closes on Cancel without calling the action", async () => {
    renderRoster(true);
    await openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(purgeArchivedLearner).not.toHaveBeenCalled();
  });
});
