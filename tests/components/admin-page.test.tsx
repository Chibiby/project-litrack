import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Inside RoleShell, AppShell renders only <main> + the page's own content.
vi.mock("@/components/role-shell", () => ({ useRoleShell: () => true }));

const { AdminPage } = await import("@/components/admin/admin-page");

afterEach(cleanup);

describe("AdminPage", () => {
  it("renders the compact title block with description and actions when no hero is given", () => {
    render(
      <AdminPage
        title="Platform audit"
        description="Recent audited actions."
        role="SUPER_ADMIN"
        userName="Admin"
        actions={<button type="button">Export</button>}
      >
        <p>Body</p>
      </AdminPage>
    );
    expect(screen.getByRole("heading", { level: 1, name: "Platform audit" })).not.toBeNull();
    expect(screen.getByText("Recent audited actions.")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Export" })).not.toBeNull();
    expect(screen.getByText("Body")).not.toBeNull();
    expect(screen.getByRole("main")).not.toBeNull();
  });

  it("replaces the title block with the hero, dropping description and actions", () => {
    render(
      <AdminPage
        title="Schools"
        description="Should not show"
        role="SUPER_ADMIN"
        userName="Admin"
        actions={<button type="button">Hidden action</button>}
        hero={<h1>Hero title</h1>}
        callout={<p>Heads up</p>}
      >
        <p>Body</p>
      </AdminPage>
    );
    expect(screen.getByRole("heading", { level: 1, name: "Hero title" })).not.toBeNull();
    expect(screen.queryByText("Should not show")).toBeNull();
    expect(screen.queryByRole("button", { name: "Hidden action" })).toBeNull();
    expect(screen.getByText("Heads up")).not.toBeNull();
  });
});
