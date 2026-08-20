import { render, cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pathname = vi.hoisted(() => ({ value: "/teacher" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.value,
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href, prefetch: _p, ...rest }: any) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock("@/components/nav-prefetcher", () => ({
  NavPrefetcher: () => null,
}));
vi.mock("@/lib/actions/auth", () => ({ logoutAction: vi.fn() }));

import { AppSidebar } from "@/components/app-sidebar";

afterEach(cleanup);

function renderTeacherSidebar(props?: { roleLabel?: string }) {
  return render(
    <AppSidebar
      role="TEACHER"
      userName="Marivic M. Acibar"
      schoolName="Malandag Central Elementary"
      grades={[{ id: "g1", label: "Grade 3", hasAral: true }]}
      expanded
      {...props}
    />
  );
}

describe("AppSidebar — teacher", () => {
  beforeEach(() => {
    pathname.value = "/teacher";
  });

  it("renders both section headings", () => {
    renderTeacherSidebar();
    expect(screen.getAllByText("Menu").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ARAL Program").length).toBeGreaterThan(0);
  });

  it("renders the ARAL program links", () => {
    renderTeacherSidebar();
    expect(
      screen.getAllByRole("link", { name: "Weekly Attendance" })[0].getAttribute("href")
    ).toBe("/teacher/aral/g1/attendance");
    expect(
      screen
        .getAllByRole("link", { name: "Monthly Reading Level" })[0]
        .getAttribute("href")
    ).toBe("/teacher/aral/g1/reading-level");
  });

  it("marks only the active item with aria-current", () => {
    renderTeacherSidebar();
    const current = screen.getAllByRole("link", { current: "page" });
    expect(current.every((el) => el.textContent?.includes("Dashboard"))).toBe(true);
  });

  it("shows the brand block with the school name", () => {
    renderTeacherSidebar();
    expect(screen.getAllByText("LITRACK").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Malandag Central Elementary").length
    ).toBeGreaterThan(0);
  });

  it("renders a log out control in the footer", () => {
    renderTeacherSidebar();
    // SignOutButton's visible label is "Sign out".
    expect(
      screen.getAllByRole("button", { name: /sign out|log ?out/i }).length
    ).toBeGreaterThan(0);
  });

  it("names the account by the humanised role when no label is supplied", () => {
    renderTeacherSidebar();
    // Rendered lowercase and CSS-capitalised, so assert on the DOM text.
    expect(screen.getAllByText("teacher").length).toBeGreaterThan(0);
  });

  it("names an ARAL Volunteer by their designation instead of their role", () => {
    // A Non-DepEd ARAL Volunteer holds the TEACHER role, so the enum is the wrong
    // thing to show them. The nav still has to be a teacher's nav.
    renderTeacherSidebar({ roleLabel: "ARAL Volunteer" });
    expect(screen.getAllByText("ARAL Volunteer").length).toBeGreaterThan(0);
    expect(screen.queryByText("teacher")).toBeNull();
    expect(screen.getAllByText("ARAL Program").length).toBeGreaterThan(0);
  });
});

describe("AppSidebar — school head", () => {
  it("renders no section heading for single-group roles", () => {
    pathname.value = "/school-head";
    render(<AppSidebar role="SCHOOL_HEAD" userName="Head" expanded />);
    expect(screen.queryByText("Menu")).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "Teachers" })[0].getAttribute("href")
    ).toBe("/school-head/teachers");
  });
});
