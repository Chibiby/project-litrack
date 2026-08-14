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

function renderHeader(onToggle = vi.fn()) {
  render(
    <ThemeProvider>
      <AppHeader
        role="TEACHER"
        grades={[{ id: "g1", label: "Grade 3", hasAral: true }]}
        notifications={[]}
        expanded
        onToggleSidebar={onToggle}
      />
    </ThemeProvider>
  );
  return onToggle;
}

describe("AppHeader", () => {
  it("shows the page title from the active nav item", () => {
    pathname.value = "/teacher";
    renderHeader();
    expect(screen.getByRole("heading", { name: "Dashboard" })).not.toBeNull();
  });

  it("updates the title for a nested route", () => {
    pathname.value = "/teacher/learners/abc";
    renderHeader();
    expect(screen.getByRole("heading", { name: "Learners" })).not.toBeNull();
  });

  it("renders search, notifications and the theme toggle", () => {
    pathname.value = "/teacher";
    renderHeader();
    expect(screen.getByRole("searchbox")).not.toBeNull();
    expect(screen.getByRole("button", { name: /notifications/i })).not.toBeNull();
    expect(screen.getByRole("button", { name: /switch to (dark|light) mode/i })).not.toBeNull();
  });

  it("calls onToggleSidebar when the collapse button is pressed", () => {
    pathname.value = "/teacher";
    const onToggle = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});
