// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

let pathname = "/admin";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

import { AdminShellGate } from "@/components/admin-shell-gate";

function ui() {
  return (
    <AdminShellGate shell={<nav data-testid="shell">sidebar + header</nav>}>
      <main data-testid="page">page</main>
    </AdminShellGate>
  );
}

afterEach(() => cleanup());

describe("AdminShellGate", () => {
  it("renders the shell on admin pages", () => {
    pathname = "/admin/monitoring/division-summary";
    render(ui());
    expect(screen.getByTestId("shell")).toBeTruthy();
    expect(screen.queryByTestId("page")).toBeNull();
  });

  it("renders the login page bare even when a signed-in admin's shell was rendered", () => {
    pathname = "/admin/login";
    render(ui());
    expect(screen.queryByTestId("shell")).toBeNull();
    expect(screen.getByTestId("page")).toBeTruthy();
  });

  it("drops the shell when a client navigation lands on /admin/login", () => {
    pathname = "/admin";
    const view = render(ui());
    expect(screen.getByTestId("shell")).toBeTruthy();
    pathname = "/admin/login";
    view.rerender(ui());
    expect(screen.queryByTestId("shell")).toBeNull();
    expect(screen.getByTestId("page")).toBeTruthy();
  });
});
