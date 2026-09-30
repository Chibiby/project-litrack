import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireAdminScope = vi.fn();
vi.mock("@/lib/auth/district-scope", () => ({ requireAdminScope }));
vi.mock("@/components/role-shell", () => ({ useRoleShell: () => true }));
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

const { default: DistrictSummaryIndexPage } = await import("@/app/district/summary/page");
const { DISTRICT_SUMMARY_FACETS } = await import("@/lib/routes/district");

afterEach(() => {
  cleanup();
  requireAdminScope.mockReset();
});

describe("/district/summary index", () => {
  it("lists every facet linking to /district/summary/[facet] and shows the admin's districts", async () => {
    requireAdminScope.mockResolvedValue({
      user: { role: "DISTRICT_ADMIN", fullName: "Dana", email: "d@x.test" },
      scope: { kind: "districts", districts: ["Alpha"] },
    });
    render(await DistrictSummaryIndexPage());

    expect(screen.getByText("Schools in Alpha")).not.toBeNull();
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    for (const facet of DISTRICT_SUMMARY_FACETS) {
      expect(hrefs).toContain(`/district/summary/${facet.id}`);
    }
  });

  it("says so when the admin has no districts assigned", async () => {
    requireAdminScope.mockResolvedValue({
      user: { role: "DISTRICT_ADMIN", fullName: "", email: "d@x.test" },
      scope: { kind: "districts", districts: [] },
    });
    render(await DistrictSummaryIndexPage());
    expect(screen.getByText("No districts assigned yet")).not.toBeNull();
  });
});
