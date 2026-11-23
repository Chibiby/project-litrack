import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ARAL Profiling's filter row: the same purple, grade-grouped advisory filter
 * as Learners (All advisories, then each grade over its sections), not a plain
 * Section select. Picking an advisory writes `?section=` and resets the page.
 */

const listNavigate = vi.fn();
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("schoolId=sch&page=3&status=pending"),
}));
vi.mock("@/components/nav/list-navigation", () => ({
  useListNavigate: () => listNavigate,
}));

const { ProfilingToolbar } = await import("@/components/aral/profiling-toolbar");

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => listNavigate.mockReset());
afterEach(cleanup);

const ADVISORIES = [
  { id: "ka", label: "Kinder - A" },
  { id: "kb", label: "Kinder - B" },
  { id: "g1a", label: "Grade 1 - A" },
];

describe("ProfilingToolbar advisory filter", () => {
  it("defaults to All advisories, grouped by grade, with no Section select", () => {
    render(<ProfilingToolbar q="" section="all" advisories={ADVISORIES} status="pending" />);
    expect(screen.queryByRole("combobox", { name: "Section" })).toBeNull();
    const trigger = screen.getByRole("combobox", { name: "Advisory" });
    expect(trigger.textContent).toContain("All advisories");
    fireEvent.click(trigger);
    const listbox = screen.getByRole("listbox");
    expect(within(listbox).getByText("Kinder")).toBeTruthy();
    expect(within(listbox).getByText("Grade 1")).toBeTruthy();
    expect(screen.getByRole("option", { name: "Kinder - B" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Grade 1 - A" })).toBeTruthy();
  });

  it("writes the picked advisory as ?section= and drops the page", () => {
    render(<ProfilingToolbar q="" section="all" advisories={ADVISORIES} status="pending" />);
    fireEvent.click(screen.getByRole("combobox", { name: "Advisory" }));
    fireEvent.click(screen.getByRole("option", { name: "Grade 1 - A" }));
    const href = listNavigate.mock.calls[0][0] as string;
    const sp = new URL(href, "http://x").searchParams;
    expect(new URL(href, "http://x").pathname).toBe("/teacher/aral/profiling");
    expect(sp.get("section")).toBe("g1a");
    expect(sp.get("status")).toBe("pending");
    expect(sp.get("schoolId")).toBe("sch");
    expect(sp.get("page")).toBeNull();
  });

  it("All advisories clears the section", () => {
    render(<ProfilingToolbar q="" section="kb" advisories={ADVISORIES} status="all" />);
    fireEvent.click(screen.getByRole("combobox", { name: "Advisory" }));
    fireEvent.click(screen.getByRole("option", { name: "All advisories" }));
    const sp = new URL(listNavigate.mock.calls[0][0] as string, "http://x").searchParams;
    expect(sp.get("section")).toBeNull();
  });

  it("hides the filter with one advisory or none", () => {
    render(
      <ProfilingToolbar q="" section="all" advisories={[ADVISORIES[0]]} status="all" />
    );
    expect(screen.queryByRole("combobox", { name: "Advisory" })).toBeNull();
  });
});
