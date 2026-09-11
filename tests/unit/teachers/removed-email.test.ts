import { describe, expect, it } from "vitest";
import { originalTeacherEmail } from "@/lib/teachers/removed-email";
import { TEACHER_EMAIL_DOMAIN } from "@/lib/auth/synthetic-email";

/**
 * Removing a teacher rewrites their login email so the address can register
 * again. The Removed tab still wants to show the School Head who that was, so
 * it reads the original back out of the rewrite — when the rewrite kept it.
 */
describe("originalTeacherEmail", () => {
  it("recovers the address from a School Head removal", () => {
    expect(originalTeacherEmail("ana.cruz@deped.gov.ph.deleted.1757570000000")).toBe(
      "ana.cruz@deped.gov.ph"
    );
  });

  it("returns null for a Super Admin removal, which does not keep the address", () => {
    expect(
      originalTeacherEmail(`removed+1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9@${TEACHER_EMAIL_DOMAIN}`)
    ).toBeNull();
  });

  it("passes through an address that was never rewritten", () => {
    expect(originalTeacherEmail("ana.cruz@deped.gov.ph")).toBe("ana.cruz@deped.gov.ph");
  });

  it("only strips the removal suffix, not a lookalike in the middle", () => {
    expect(originalTeacherEmail("x.deleted.1@school.ph.deleted.99")).toBe("x.deleted.1@school.ph");
  });
});
