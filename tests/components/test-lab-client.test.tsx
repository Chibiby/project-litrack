import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TestLabChecklistItem } from "@/lib/test-lab/checklist";
import type { TestLabPageData } from "@/components/admin/test-lab";

/**
 * `/admin/test-lab`'s client component: proves the "not prepared" state
 * shows Prepare rather than the checklist, a prepared state renders the
 * checklist grouped by role, and a `localStorage` failure never crashes the
 * page — the checklist ticks are best-effort only.
 *
 * This repo has no @testing-library/jest-dom — native DOM assertions only.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const prepareTestLab = vi.fn(async () => ({ ok: true, fixtures: {} }));
const resetDemoData = vi.fn(async () => ({ ok: true, data: { count: 1, initialPassword: "123456" } }));
const startDemoSession = vi.fn(async () => ({ ok: true, data: { expiresAt: Date.now() + 1000 } }));
const endDemoSession = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/actions/demo", () => ({
  startDemoSession: (...args: unknown[]) => startDemoSession(...(args as [])),
  endDemoSession: (...args: unknown[]) => endDemoSession(...(args as [])),
  prepareTestLab: (...args: unknown[]) => prepareTestLab(...(args as [])),
  resetDemoData: (...args: unknown[]) => resetDemoData(...(args as [])),
}));

const startTestLabSession = vi.fn(async (_fd?: FormData) => ({ ok: true }));
vi.mock("@/lib/actions/accounts", () => ({
  startTestLabSession: (...args: unknown[]) => startTestLabSession(...(args as [])),
}));

const toastFn = vi.fn() as unknown as typeof import("sonner").toast & {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};
toastFn.success = vi.fn();
toastFn.error = vi.fn();
vi.mock("sonner", () => ({ toast: toastFn }));

const { TestLabClient } = await import("@/components/admin/test-lab");

const CHECKLIST: TestLabChecklistItem[] = [
  { id: "sh-dashboard", role: "SCHOOL_HEAD", group: "Dashboard", label: "Dashboard", href: "/school-head" },
  { id: "t-dashboard", role: "TEACHER", group: "Dashboard", label: "Dashboard", href: "/teacher" },
];

function baseData(overrides: Partial<TestLabPageData["status"]> = {}): TestLabPageData {
  return {
    status: {
      demoSchoolExists: true,
      prepared: false,
      demoSessionExpiresAt: null,
      ...overrides,
    },
    checklist: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("TestLabClient", () => {
  it("shows Prepare test data when fixtures are not ready", () => {
    render(<TestLabClient data={baseData()} />);

    expect(screen.getByRole("button", { name: "Prepare test data" })).toBeTruthy();
    expect(screen.queryByText("Dashboard")).toBeNull();
  });

  it("renders the checklist, grouped by role, once prepared", () => {
    const data: TestLabPageData = {
      status: { demoSchoolExists: true, prepared: true, demoSessionExpiresAt: null },
      checklist: CHECKLIST,
    };
    render(<TestLabClient data={data} />);

    expect(screen.queryByRole("button", { name: "Prepare test data" })).toBeNull();
    expect(screen.getByText("School Head")).toBeTruthy();
    expect(screen.getByText("Teacher")).toBeTruthy();
    expect(screen.getAllByText("/school-head")).toHaveLength(1);
    expect(screen.getAllByText("/teacher")).toHaveLength(1);
    expect(screen.getByText("0 of 2 checked")).toBeTruthy();
  });

  it("links to demo settings when no demo school exists yet", () => {
    render(<TestLabClient data={baseData({ demoSchoolExists: false })} />);

    const link = screen.getByRole("link", { name: "Create demo data" });
    expect(link.getAttribute("href")).toBe("/admin/settings/demo");
    expect(screen.queryByRole("button", { name: "Reset test data" })).toBeNull();
  });

  it("does not crash when localStorage throws", () => {
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("blocked");
    };

    const data: TestLabPageData = {
      status: { demoSchoolExists: true, prepared: true, demoSessionExpiresAt: null },
      checklist: CHECKLIST,
    };
    expect(() => render(<TestLabClient data={data} />)).not.toThrow();
    expect(screen.getByText("School Head")).toBeTruthy();

    window.localStorage.getItem = original;
  });
});
