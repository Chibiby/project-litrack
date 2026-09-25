import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let pathname = "/admin/settings/profile";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span data-testid="hero-art" aria-label={alt} />,
}));

const { AdminSettingsShell, activeSettingsHref } = await import(
  "@/components/settings/admin-settings-shell"
);

afterEach(() => {
  cleanup();
  pathname = "/admin/settings/profile";
});

describe("activeSettingsHref", () => {
  it("matches a row exactly or by a nested path", () => {
    expect(activeSettingsHref("/admin/settings/security")).toBe("/admin/settings/security");
    expect(activeSettingsHref("/admin/settings/demo/anything")).toBe("/admin/settings/demo");
  });

  it("does not match a sibling that merely shares a prefix", () => {
    expect(activeSettingsHref("/admin/settings/profile-extra")).toBeNull();
    expect(activeSettingsHref("/admin/schools")).toBeNull();
  });
});

describe("AdminSettingsShell", () => {
  it("marks the current row and titles the hero after it", () => {
    pathname = "/admin/settings/security";
    render(
      <AdminSettingsShell>
        <p>Security body</p>
      </AdminSettingsShell>
    );

    expect(screen.getByRole("heading", { level: 1, name: "Security" })).not.toBeNull();
    const nav = screen.getByRole("navigation", { name: "Settings" });
    const current = within(nav).getByRole("link", { current: "page" });
    expect(current.textContent).toContain("Security");
    expect(current.getAttribute("href")).toBe("/admin/settings/security");
    expect(screen.getByText("Security body")).not.toBeNull();
  });

  it("offers every Super Admin settings row, including the system-wide ones", () => {
    render(
      <AdminSettingsShell>
        <p>Body</p>
      </AdminSettingsShell>
    );
    const nav = screen.getByRole("navigation", { name: "Settings" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());
    expect(labels).toEqual(["Profile", "Security", "Demo session", "Submissions"]);
    expect(screen.getByRole("heading", { level: 1, name: "Profile Settings" })).not.toBeNull();
  });
});
