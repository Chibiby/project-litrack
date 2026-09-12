import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/cache/unstable", () => ({ cachedQuery: vi.fn() }));
vi.mock("@/lib/cache/tags", () => ({ schoolsList: "schools-list" }));

import { parseSchoolsListParams } from "@/lib/cache/schools-list";

describe("parseSchoolsListParams", () => {
  it("accepts active and inactive status filters", () => {
    expect(parseSchoolsListParams({ status: "active" }).status).toBe("active");
    expect(parseSchoolsListParams({ status: "inactive" }).status).toBe("inactive");
  });

  it("ignores unsupported status values and trims the other filters", () => {
    expect(
      parseSchoolsListParams({ q: "  Opong ", region: " Region XII ", status: "paused" })
    ).toMatchObject({ q: "Opong", region: "Region XII", status: "" });
  });
});
