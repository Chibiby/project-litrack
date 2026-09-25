import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountRow } from "@/lib/admin/accounts";

/**
 * Which account rows offer "Sign in as" (docs/specs/district-admin.md I14).
 *
 * District admin rows offer it, so the division office can open the district
 * portal as that district admin sees it; Super Admin rows never do. The server
 * refuses a Super Admin target independently (tests/unit/actions/accounts.test.ts).
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), replace: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/actions/accounts", () => ({
  revealSchoolHeadPassword: vi.fn(),
  resetSchoolHeadPasswordToDefault: vi.fn(),
  resetTeacherPassword: vi.fn(),
  resetDistrictAdminPassword: vi.fn(),
  impersonateUser: vi.fn(),
  getAccountProfile: vi.fn(),
}));
vi.mock("@/lib/actions/avatar", () => ({ removeUserAvatar: vi.fn() }));

const { AccountRowActions } = await import("@/components/admin/account-row-actions");

function row(overrides: Partial<AccountRow>): AccountRow {
  return {
    id: "user-1",
    role: "TEACHER",
    fullName: "Some Person",
    listingName: "Person, Some",
    avatarPath: null,
    schoolId: null,
    school: null,
    signIn: { kind: "username", value: "some.person" },
    isActive: true,
    mustChangePassword: false,
    approvalStatus: null,
    password: { kind: "never_stored" },
    signInHead: false,
    districtAdminDistricts: null,
    canRecoverByEmail: false,
    ...overrides,
  };
}

afterEach(cleanup);

describe("AccountRowActions — Sign in as", () => {
  it("offers Sign in as on a district admin row", () => {
    render(
      <AccountRowActions
        row={row({ role: "DISTRICT_ADMIN", districtAdminDistricts: ["Alabel 1", "Alabel 2"] })}
      />
    );
    expect(screen.getByRole("button", { name: /sign in as/i })).toBeTruthy();
  });

  it("never offers Sign in as on a Super Admin row", () => {
    render(<AccountRowActions row={row({ role: "SUPER_ADMIN" })} />);
    expect(screen.queryByRole("button", { name: /sign in as/i })).toBeNull();
  });
});
