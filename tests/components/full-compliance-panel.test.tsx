import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FullCompliancePanel } from "@/components/summary/full-compliance-panel";
import type {
  FullComplianceSchool,
  FullComplianceView,
} from "@/lib/summary/types";

afterEach(cleanup);

function school(
  over: Partial<FullComplianceSchool> & { schoolId: string },
): FullComplianceSchool {
  return {
    name: `School ${over.schoolId.toUpperCase()}`,
    schoolIdCode: `1000${over.schoolId}`,
    district: "North",
    status: "FULL",
    flags: [],
    streak: 12,
    history: [],
    ...over,
  };
}

const A = school({
  schoolId: "a",
  status: "CONSISTENT",
  streak: 45,
  history: [
    {
      dateKey: "2026-10-11",
      from: "NON_COMPLIANT",
      to: "COMPLIANT",
      flags: [],
    },
  ],
});
const B = school({
  schoolId: "b",
  status: "NON_COMPLIANT",
  streak: null,
  flags: ["Pending", "Incomplete"],
  district: "South",
});
const C = school({ schoolId: "c", status: "NEW", streak: 3 });

function view(over: Partial<FullComplianceView> = {}): FullComplianceView {
  return {
    cards: { total: 3, compliant: 2, consistent: 1, ratePct: 66.7 },
    ranking: [
      { district: "North", compliant: 2, total: 2, pct: 100 },
      { district: "South", compliant: 0, total: 1, pct: 0 },
    ],
    recent: [{ school: C, dateKey: "2026-11-22" }],
    lost: [{ school: B, dateKey: "2026-11-21", flags: ["Pending"] }],
    leaderboard: [A, C],
    recognition: [A],
    directory: [A, C, B],
    trackingSince: "2026-09-01",
    todayKey: "2026-11-24",
    ...over,
  };
}

const desktopTable = () =>
  screen.getByRole("table", { name: "School compliance directory" });

describe("FullCompliancePanel", () => {
  it("renders the four cards with their values", () => {
    render(<FullCompliancePanel view={view()} />);
    for (const [title, value] of [
      ["Active schools", "3"],
      ["Fully compliant schools", "2"],
      ["Consistently compliant", "1"],
      ["Overall compliance rate", "66.7%"],
    ]) {
      const card = screen
        .getAllByText(title)
        .map((el) => el.closest("[data-stat-card]"))
        .find(Boolean) as HTMLElement;
      expect(card).toBeTruthy();
      expect(card.textContent).toContain(value);
    }
  });

  it("hides district ranking for one district", () => {
    const { rerender } = render(<FullCompliancePanel view={view()} />);
    expect(
      screen.getByRole("heading", { name: "District ranking" }),
    ).toBeTruthy();
    rerender(
      <FullCompliancePanel
        view={view({
          ranking: [{ district: "North", compliant: 2, total: 3, pct: 67 }],
        })}
      />,
    );
    expect(
      screen.queryByRole("heading", { name: "District ranking" }),
    ).toBeNull();
  });

  it("status filter narrows the directory", () => {
    render(<FullCompliancePanel view={view()} />);
    const rowNames = () =>
      within(desktopTable())
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.querySelector("th, td")?.textContent ?? "")
        .filter((t) => t.startsWith("School"));
    expect(rowNames()).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /^Non-compliant/ }));
    expect(rowNames()).toEqual([expect.stringContaining("School B")]);
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(rowNames()).toHaveLength(3);
  });

  it("expanding a row shows its history", () => {
    render(<FullCompliancePanel view={view()} />);
    const toggle = within(desktopTable()).getByRole("button", {
      name: "Show history for School A",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = document.getElementById(
      toggle.getAttribute("aria-controls")!,
    )!;
    expect(panel.textContent).toContain("Became compliant");
    expect(panel.textContent).toContain("Oct 11, 2026");
  });

  it("empty recent/lost show their empty lines", () => {
    render(<FullCompliancePanel view={view({ recent: [], lost: [] })} />);
    expect(
      screen.getByText("No school became compliant in the last 7 days."),
    ).toBeTruthy();
    expect(
      screen.getByText("No school lost compliance in the last 7 days."),
    ).toBeTruthy();
  });

  it("streak cell shows — for non-compliant", () => {
    render(<FullCompliancePanel view={view()} />);
    const row = within(desktopTable()).getByText("School B").closest("tr")!;
    const cells = [...row.querySelectorAll("td")].map(
      (c) => c.textContent ?? "",
    );
    expect(cells.some((t) => /^—(Not set|No streak)?$/.test(t))).toBe(true);
    expect(cells).toContain("2");
  });

  it("names the tracking start in the footer", () => {
    render(<FullCompliancePanel view={view()} />);
    expect(screen.getByText(/Tracking since Sep 1, 2026/)).toBeTruthy();
  });
});
