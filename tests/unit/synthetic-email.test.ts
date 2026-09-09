import { describe, expect, it } from "vitest";
import {
  isSyntheticEmail,
  schoolHeadSyntheticEmail,
  teacherSyntheticEmail,
} from "@/lib/auth/synthetic-email";

/**
 * `isSyntheticEmail` decides one thing: whether the security page offers this
 * account an email password reset, or tells them their credentials have to be
 * regenerated for them.
 *
 * Getting it wrong in the permissive direction is the harmful one — the person
 * is shown a reset flow, the mail is sent to an address no mailbox answers, and
 * they wait for a message that will never arrive.
 */
describe("isSyntheticEmail", () => {
  it("recognises the addresses the app itself mints", () => {
    expect(isSyntheticEmail(schoolHeadSyntheticEmail("SAR-001"))).toBe(true);
    expect(isSyntheticEmail(teacherSyntheticEmail("teacher.cruz.1a2b"))).toBe(true);
  });

  it("recognises a division admin provisioned at the synthetic domain", () => {
    // `scripts/seed-division-admins.ts` mints these. The check used to require
    // an `sh@` prefix, so these accounts were offered email recovery that could
    // never arrive.
    expect(isSyntheticEmail("john@litrack.local")).toBe(true);
    expect(isSyntheticEmail("BRANDAN@LITRACK.LOCAL")).toBe(true);
  });

  it("leaves a real address alone", () => {
    expect(isSyntheticEmail("teacher@deped.gov.ph")).toBe(false);
    expect(isSyntheticEmail("someone@gmail.com")).toBe(false);
  });

  it("does not match a domain that merely ends in the same letters", () => {
    // `notlitrack.local` is a different domain; a suffix check without the dot
    // would claim it.
    expect(isSyntheticEmail("someone@notlitrack.local")).toBe(false);
  });
});
