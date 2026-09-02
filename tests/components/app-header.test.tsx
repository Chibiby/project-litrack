import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/teacher" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

import { AppHeader } from "@/components/shell/app-header";
import { ThemeProvider } from "@/components/theme/theme-provider";

afterEach(cleanup);

function renderHeader(onToggle = vi.fn(), props?: { isAralVolunteer?: boolean }) {
  render(
    <ThemeProvider>
      <AppHeader
        role="TEACHER"
        grades={[{ id: "g1", label: "Grade 3", hasAral: true }]}
        notifications={[]}
        expanded
        onToggleSidebar={onToggle}
        {...props}
      />
    </ThemeProvider>
  );
  return onToggle;
}

describe("AppHeader", () => {
  it("shows the page title from the active nav item", () => {
    pathname.value = "/teacher";
    renderHeader();
    expect(screen.getByText("Dashboard")).not.toBeNull();
  });

  it("updates the title for a nested route", () => {
    pathname.value = "/teacher/learners/abc";
    renderHeader();
    expect(screen.getByText("Learners")).not.toBeNull();
  });

  it("does not render the header title as a heading (the body owns the page's h1)", () => {
    pathname.value = "/teacher";
    renderHeader();
    expect(screen.queryByRole("heading", { name: "Dashboard" })).toBeNull();
  });

  it("renders search, notifications and the theme toggle", () => {
    pathname.value = "/teacher";
    renderHeader();
    expect(screen.getByRole("combobox")).not.toBeNull();
    expect(screen.getByRole("button", { name: /notifications/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /switch to (dark|light) mode/i })).not.toBeNull();
  });

  it("calls onToggleSidebar when the collapse button is pressed", () => {
    pathname.value = "/teacher";
    const onToggle = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("drops the search box for an ARAL volunteer but keeps the rest of the bar", () => {
    // The teacher search target is /teacher/learners, which a volunteer cannot
    // open. A box that navigates somewhere its query is ignored is worse than no
    // box, so it is removed rather than repointed.
    pathname.value = "/teacher/aral";
    renderHeader(vi.fn(), { isAralVolunteer: true });
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByRole("button", { name: /notifications/i })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: /switch to (dark|light) mode/i })
    ).not.toBeNull();
  });

  it("still names the roster page for a volunteer, whose Learners item is inert", () => {
    // For a volunteer the Learners item is marked `unavailable`, so navigable()
    // drops it and the title can no longer come from the nav label. It falls
    // through to the humanised path segment — which lands on "Learners" anyway.
    // Worth asserting through the component because both failure modes are
    // silent: a blank chrome label, or "Dashboard" leaking in from the /teacher
    // role-root prefix match. The volunteer can still reach this URL (dashboard
    // cards link here), so the header must name where they are.
    pathname.value = "/teacher/learners";
    renderHeader(vi.fn(), { isAralVolunteer: true });
    expect(screen.getByText("Learners")).not.toBeNull();
    // The header carries no nav links, so the inert row's absence here is
    // expected — the search combobox is the only volunteer-conditional control.
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
