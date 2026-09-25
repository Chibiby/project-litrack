import { cleanup, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SummaryList } from "@/lib/summary/types";

vi.mock("@/components/nav/prefetch-link", () => ({
  PrefetchLink: ({ href, children, className }: { href: string; children?: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import { buildDistrictAttention, previewSchools } from "@/components/district/overview-attention";
import { DistrictsPanel, districtQuickLinks } from "@/components/district/districts-panel";

afterEach(cleanup);

function list(id: string, title: string, names: string[]): SummaryList {
  return { id, title, columns: ["School"], rows: names.map((n) => [n]) };
}

describe("previewSchools", () => {
  it("names up to two schools and counts the rest", () => {
    expect(previewSchools([["A"]])).toBe("A");
    expect(previewSchools([["A"], ["B"]])).toBe("A and B");
    expect(previewSchools([["A"], ["B"], ["C"], ["D"]])).toBe("A, B and 2 more");
  });
});

describe("buildDistrictAttention", () => {
  const href = "/district/summary/compliance";

  it("shows an all-clear row, not a link, when nothing is open or flagged", () => {
    const items = buildDistrictAttention({
      notifications: [],
      complianceLists: [list("PENDING", "Pending", [])],
      complianceHref: href,
    });
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("all-clear");
    expect(items[0]!.href).toBe("");
  });

  it("puts open tickets first, then the biggest flag lists, deep-linked to their anchor", () => {
    const items = buildDistrictAttention({
      notifications: [
        {
          id: "district-open-tickets",
          title: "2 support requests need an answer",
          description: "From schools in your districts.",
          href: "/district/support",
          tone: "amber",
        },
      ],
      complianceLists: [
        list("PENDING", "Pending", ["A"]),
        list("NOT_UPDATED", "Not updated", ["A", "B", "C"]),
      ],
      complianceHref: href,
    });
    expect(items.map((i) => i.id)).toEqual([
      "district-open-tickets",
      "compliance-NOT_UPDATED",
      "compliance-PENDING",
    ]);
    expect(items[1]!.href).toBe(`${href}#summary-list-NOT_UPDATED`);
    expect(items[1]!.badge).toBe("3 schools");
    expect(items[2]!.badge).toBe("1 school");
  });

  it("collapses lists past the limit into one link to the whole page", () => {
    const items = buildDistrictAttention({
      notifications: [],
      complianceLists: [
        list("A", "A", ["x"]),
        list("B", "B", ["x"]),
        list("C", "C", ["x"]),
        list("D", "D", ["x"]),
        list("E", "E", ["x"]),
      ],
      complianceHref: href,
      limit: 3,
    });
    expect(items).toHaveLength(4);
    expect(items[3]).toMatchObject({ id: "compliance-more", label: "2 more compliance flags", href });
  });
});

describe("DistrictsPanel", () => {
  it("gives each named district summary links and none to the no-district bucket", () => {
    expect(districtQuickLinks(null)).toEqual([]);
    const links = districtQuickLinks("Alabel 1");
    expect(links.map((l) => l.label)).toEqual(["Learners", "Attendance", "Compliance", "Schools"]);
    expect(links[0]!.href).toBe("/district/summary/learners?district=Alabel%201");
    expect(links[3]!.href).toBe("/district/schools?q=Alabel%201");
  });

  it("renders a card per district with counts and its links", () => {
    render(
      <DistrictsPanel
        title="Your districts"
        totalSchools={5}
        districts={[
          { district: "Alabel 1", schoolCount: 4, activeCount: 3 },
          { district: null, schoolCount: 1, activeCount: 1 },
        ]}
      />
    );
    expect(screen.getByRole("heading", { name: "Your districts" })).toBeTruthy();
    expect(screen.getByText("4 schools · 1 inactive")).toBeTruthy();
    const alabel = screen.getByRole("list", { name: "Summaries for Alabel 1" });
    expect(within(alabel).getAllByRole("link")).toHaveLength(4);
    expect(screen.queryByRole("list", { name: /Summaries for No district/ })).toBeNull();
    expect(screen.getByRole("link", { name: /5 schools in all/ }).getAttribute("href")).toBe(
      "/district/schools"
    );
  });

  it("says so when the scope has no schools", () => {
    render(<DistrictsPanel title="Districts" totalSchools={0} districts={[]} />);
    expect(screen.getByText("No schools are recorded in your scope yet.")).toBeTruthy();
  });
});
