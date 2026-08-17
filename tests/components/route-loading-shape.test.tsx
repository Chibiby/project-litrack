/**
 * Guards the "two skeletons" regression.
 *
 * A route's `loading.tsx` is replaced by that page's own Suspense fallback, so
 * whenever the two draw different shapes the teacher sees one skeleton morph
 * into a second before the content lands. The rule this file enforces:
 *
 *  - a boundary that knows its route mirrors that page's first paint;
 *  - a boundary that cannot know its route draws nothing route-shaped.
 *
 * `/teacher/(app)/loading.tsx` is the second kind: it wraps the dashboard, the
 * roster, ARAL and reports alike, so a table skeleton there rendered a table on
 * top of the dashboard.
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import TeacherLearnersLoading from "@/app/teacher/(app)/learners/loading";
import TeacherLoading from "@/app/teacher/(app)/loading";
import TeacherDashboardLoading from "@/app/teacher/(app)/(dashboard)/loading";
import { clearPendingPostLoginSplash } from "@/lib/post-login-flag";

afterEach(cleanup);
beforeEach(() => {
  // The bridge covers every fresh document; release it so the skeleton renders.
  clearPendingPostLoginSplash();
});

describe("teacher route loading boundaries", () => {
  it("the roster boundary mirrors the roster's first paint", () => {
    const { container } = render(<TeacherLearnersLoading />);

    expect(
      container.querySelectorAll('[data-slot="stat-card-skeleton"]')
    ).toHaveLength(4);
    expect(
      container.querySelector('[data-slot="roster-header-skeleton"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-slot="table-skeleton"]')
    ).not.toBeNull();
  });

  it("the dashboard boundary mirrors the dashboard's first paint", () => {
    const { container } = render(<TeacherDashboardLoading />);

    // Same four cards the page's own Suspense fallback draws, and no table.
    expect(
      container.querySelectorAll('[data-slot="stat-card-skeleton"]')
    ).toHaveLength(4);
    expect(
      container.querySelectorAll('[data-slot="table-skeleton"]')
    ).toHaveLength(0);
  });

  it("the tree-wide boundary draws nothing route-shaped", () => {
    const { container } = render(<TeacherLoading />);

    expect(
      container.querySelectorAll('[data-slot="table-skeleton"]')
    ).toHaveLength(0);
    expect(
      container.querySelectorAll('[data-slot="stat-card-skeleton"]')
    ).toHaveLength(0);
  });
});
