import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import { assertSameSchool } from "@/lib/auth/tenant";

/**
 * Cross-tenant leakage is the worst bug shippable here, and the defence is a
 * refusal that reveals nothing: a learner in another school and a learner that
 * never existed must be indistinguishable to the person asking. What separates
 * them is the admin record, where a cross-tenant attempt is worth reviewing and
 * a missing row is not.
 */

function caught(userSchoolId: string, resourceSchoolId: string | null | undefined, resource?: string) {
  try {
    assertSameSchool(userSchoolId, resourceSchoolId, resource);
    return null;
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    return err;
  }
}

describe("assertSameSchool", () => {
  it("passes when school ids match", () => {
    expect(caught("school-a", "school-a")).toBeNull();
  });

  it("refuses another school's row and a missing one with the SAME message", () => {
    const foreign = caught("school-a", "school-b");
    const missing = caught("school-a", null);
    expect(foreign?.code).toBe("NOT_FOUND");
    expect(missing?.code).toBe("NOT_FOUND");
    expect(foreign?.message).toBe(missing?.message);
    expect(caught("school-a", undefined)?.code).toBe("NOT_FOUND");
  });

  it("names the resource when asked, without leaking which case it was", () => {
    const err = caught("school-a", "school-b", "Learner");
    expect(err?.message).toBe("Learner not found. It may have been deleted or moved.");
    expect(err?.message).not.toContain("school-b");
  });

  it("records a cross-tenant attempt as a security event, a missing row as ordinary", () => {
    expect(caught("school-a", "school-b")?.severity).toBe("security");
    expect(caught("school-a", "school-b")?.context.crossTenant).toBe(true);
    expect(caught("school-a", null)?.severity).toBe("user");
  });

  it("keeps the other school's id for admins only", () => {
    const err = caught("school-a", "school-b");
    expect(err?.detail).toContain("school-b");
    expect(err?.message).not.toContain("school-b");
  });
});
