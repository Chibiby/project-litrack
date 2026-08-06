import { describe, expect, it } from "vitest";
import { assertSameSchool } from "@/lib/auth/tenant";

function tryAssert(userSchoolId: string, resourceSchoolId: string | null | undefined) {
  try {
    assertSameSchool(userSchoolId, resourceSchoolId);
    return { ok: true as const };
  } catch (err) {
    return {
      ok: false as const,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

describe("assertSameSchool", () => {
  it("passes when school ids match", () => {
    expect(tryAssert("school-a", "school-a")).toEqual({ ok: true });
  });

  it("throws Not found on mismatch", () => {
    const r = tryAssert("school-a", "school-b");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toBe("Not found");
  });

  it("throws Not found when resource school is null/undefined", () => {
    expect(tryAssert("school-a", null).ok).toBe(false);
    expect(tryAssert("school-a", undefined).ok).toBe(false);
  });
});
