import { describe, expect, it } from "vitest";
import { isDeveloperAdmin, superAdminLabel } from "@/lib/auth/admin-tier";

describe("isDeveloperAdmin", () => {
  it("is true only for a Super Admin whose tier is DEVELOPER", () => {
    expect(isDeveloperAdmin({ role: "SUPER_ADMIN", adminTier: "DEVELOPER" })).toBe(true);
    expect(isDeveloperAdmin({ role: "SUPER_ADMIN", adminTier: "DIVISION" })).toBe(false);
  });

  it("reads a Super Admin with no tier as a Division Admin", () => {
    expect(isDeveloperAdmin({ role: "SUPER_ADMIN", adminTier: null })).toBe(false);
    expect(superAdminLabel({ role: "SUPER_ADMIN", adminTier: null })).toBe("Division Admin");
  });

  it("never grants Developer Controls to another role, whatever the column holds", () => {
    expect(isDeveloperAdmin({ role: "SCHOOL_HEAD", adminTier: "DEVELOPER" })).toBe(false);
    expect(isDeveloperAdmin({ role: "DISTRICT_ADMIN", adminTier: "DEVELOPER" })).toBe(false);
  });

  it("labels each tier", () => {
    expect(superAdminLabel({ role: "SUPER_ADMIN", adminTier: "DEVELOPER" })).toBe("Developer Admin");
    expect(superAdminLabel({ role: "SUPER_ADMIN", adminTier: "DIVISION" })).toBe("Division Admin");
  });
});
