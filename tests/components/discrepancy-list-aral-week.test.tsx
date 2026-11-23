import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/components/nav/prefetch-link", () => ({
  PrefetchLink: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { DiscrepancyList } from "@/components/school-head/monitoring/discrepancy-list";
import { DISCREPANCY_KINDS, type DiscrepancySummary } from "@/lib/monitoring/discrepancy-kinds";

const summary: DiscrepancySummary = {
  hasActiveYear: true,
  total: 1,
  groups: DISCREPANCY_KINDS.map((kind) =>
    kind === "ARAL_WEEK_ONE_DAY"
      ? {
          kind,
          count: 1,
          items: [{ id: "t1|g3|2026-11-09", name: "Week of Nov 9, 2026", placement: "Grade 3", teacher: "Cruz, Ana" }],
        }
      : { kind, count: 0, items: [] }
  ),
};

describe("DiscrepancyList — ARAL weeks with only 1 attendance day", () => {
  it("lists the week, grade and tutor, linking to ARAL Monitoring", () => {
    render(
      <DiscrepancyList
        summary={summary}
        learnersHref={(n) => `/learners?q=${n}`}
        setupHref="/setup"
        aralHref="/school-head/monitoring/aral"
      />
    );
    expect(screen.getByRole("heading", { name: "ARAL weeks with only 1 attendance day" })).toBeTruthy();
    const row = screen.getByRole("link", { name: /Week of Nov 9, 2026/ });
    expect(row.getAttribute("href")).toBe("/school-head/monitoring/aral");
    expect(row.textContent).toContain("Grade 3");
    expect(row.textContent).toContain("Cruz, Ana");
  });
});
