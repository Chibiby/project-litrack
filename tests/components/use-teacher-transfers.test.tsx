import { cleanup, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Cancel transfer request is offered only to the teacher who sent the pending
 * request (a co-advisor sees the learner as already requested, nothing to do).
 */

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/teacher/learners",
  useSearchParams: () => new URLSearchParams(""),
  unstable_isUnrecognizedActionError: () => false,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), loading: vi.fn() }),
}));
vi.mock("@/components/nav-prefetcher", () => ({ invalidateNavWarm: vi.fn() }));
vi.mock("@/lib/actions/section-transfer", () => ({
  cancelSectionTransferRequest: vi.fn(),
  requestSectionTransfers: vi.fn(),
}));

import {
  useTeacherTransfers,
  type TeacherTransferConfig,
  type TransferableRow,
} from "@/components/learners/use-teacher-transfers";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

afterEach(cleanup);

const VIEWER = "teacher-1";
const CONFIG: TeacherTransferConfig = {
  destinations: [],
  advisedSectionIds: ["sec-a"],
  viewerId: VIEWER,
};

function row(requestedById: string | null | undefined): TransferableRow {
  return {
    id: "l-1",
    fullName: "Ana Santos",
    gradeLevelId: "g3",
    gradeType: "G3",
    archivedAt: null,
    section: { id: "sec-a", name: "Rosal" },
    pendingTransfer:
      requestedById === undefined
        ? null
        : { requestId: "r-1", toSectionName: "Sampaguita", requestedById },
  };
}

function useHook(config: TeacherTransferConfig | undefined = CONFIG) {
  return renderHook(() => useTeacherTransfers({ config, onDone: vi.fn() })).result.current;
}

describe("useTeacherTransfers — Cancel transfer request", () => {
  it("profile action is Cancel for the viewer's own pending request", () => {
    const action = useHook().profileAction(row(VIEWER), vi.fn());
    expect(action?.label).toBe("Cancel transfer request");
  });

  it("offers no action for a pending request sent by somebody else", () => {
    const action = useHook().profileAction(row("teacher-2"), vi.fn());
    expect(action).toBeUndefined();
  });

  it("offers no Cancel when the request's author is unknown", () => {
    const action = useHook().profileAction(row(null), vi.fn());
    expect(action).toBeUndefined();
  });

  it("offers Request transfer, not Cancel, when nothing is pending", () => {
    const action = useHook().profileAction(row(undefined), vi.fn());
    expect(action?.label).toBe("Request transfer");
  });

  function renderMenu(l: TransferableRow) {
    const { result } = renderHook(() => useTeacherTransfers({ config: CONFIG, onDone: vi.fn() }));
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>menu</DropdownMenuTrigger>
        <DropdownMenuContent>{result.current.menuItem(l)}</DropdownMenuContent>
      </DropdownMenu>
    );
  }

  it("row menu shows Cancel transfer request only for the viewer's own request", () => {
    renderMenu(row(VIEWER));
    expect(screen.getByRole("menuitem", { name: "Cancel transfer request" })).toBeTruthy();
  });

  it("row menu shows neither item for somebody else's pending request", () => {
    renderMenu(row("teacher-2"));
    expect(screen.queryByRole("menuitem", { name: "Cancel transfer request" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Request transfer" })).toBeNull();
  });
});
