import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SummaryScopeBar, type SummaryScopeBarProps } from "@/components/summary/summary-scope-bar";

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const base: SummaryScopeBarProps = {
  basePath: "/district/summary/learners",
  searchParams: { district: "Alabel 1" },
  level: "overall",
  district: "Alabel 1",
  schoolId: null,
  districts: ["Alabel 1", "Alabel 2"],
  schools: [
    { id: "s1", name: "Alabel Central ES", schoolIdCode: "130001", district: "Alabel 1" },
    { id: "s2", name: "Glan ES", schoolIdCode: "130002", district: "Alabel 2" },
  ],
  allDistrictsLabel: "All my districts",
};

function hrefOfLastPush(): URL {
  expect(push).toHaveBeenCalledTimes(1);
  return new URL(push.mock.calls[0]![0] as string, "http://x");
}

describe("SummaryScopeBar", () => {
  it("switching the level sets ?level and keeps the district", () => {
    render(<SummaryScopeBar {...base} />);
    fireEvent.click(screen.getByRole("button", { name: "By school" }));

    const url = hrefOfLastPush();
    expect(url.pathname).toBe("/district/summary/learners");
    expect(url.searchParams.get("level")).toBe("school");
    expect(url.searchParams.get("district")).toBe("Alabel 1");
  });

  it("going back to Overall removes the level param", () => {
    render(
      <SummaryScopeBar {...base} level="district" searchParams={{ level: "district", district: "Alabel 1" }} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Overall" }));

    const url = hrefOfLastPush();
    expect(url.searchParams.has("level")).toBe(false);
    expect(url.searchParams.get("district")).toBe("Alabel 1");
  });

  it("keeps By school enabled, with no hint, when no district is picked", () => {
    render(<SummaryScopeBar {...base} district={null} searchParams={{}} allDistrictsLabel="All districts" />);
    const bySchool = screen.getByRole("button", { name: "By school" }) as HTMLButtonElement;
    expect(bySchool.disabled).toBe(false);
    expect(screen.queryByText("Pick a district first to see its schools.")).toBeNull();

    fireEvent.click(bySchool);
    const url = hrefOfLastPush();
    expect(url.searchParams.get("level")).toBe("school");
    expect(url.searchParams.has("district")).toBe(false);
  });

  it("drops every table sort, direction and page param when the level changes", () => {
    render(
      <SummaryScopeBar
        {...base}
        level="school"
        searchParams={{
          level: "school",
          district: "Alabel 1",
          q: "glan",
          "sort.gender": "total",
          "dir.gender": "desc",
          "page.gender": "3",
          "page.englishProfile": "2",
        }}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "By district" }));

    const url = hrefOfLastPush();
    expect(url.searchParams.get("level")).toBe("district");
    expect(url.searchParams.get("district")).toBe("Alabel 1");
    expect([...url.searchParams.keys()].filter((k) => /^(sort|dir|page)\./.test(k))).toEqual([]);
  });

  it("drops the table params when the school or district changes", () => {
    render(
      <SummaryScopeBar
        {...base}
        level="school"
        searchParams={{ level: "school", district: "Alabel 1", "page.gender": "3", "sort.gender": "total" }}
      />
    );
    fireEvent.click(screen.getByRole("combobox", { name: /School/ }));
    fireEvent.click(screen.getByRole("option", { name: /Alabel Central ES/ }));

    const url = hrefOfLastPush();
    expect(url.searchParams.get("schoolId")).toBe("s1");
    expect(url.searchParams.has("page.gender")).toBe(false);
    expect(url.searchParams.has("sort.gender")).toBe(false);
  });

  it("marks the current level as pressed and does not navigate when it is clicked", () => {
    render(<SummaryScopeBar {...base} />);
    const overall = screen.getByRole("button", { name: "Overall" });
    expect(overall.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(overall);
    expect(push).not.toHaveBeenCalled();
  });
});
