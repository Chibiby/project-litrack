import type { AdvisoryMode } from "@prisma/client";
import { ARAL_VOLUNTEER_DESIGNATION } from "@/lib/validators/profile.schema";

/**
 * How many sections one teacher may advise.
 *
 * Its own module because both halves need it and neither may import the other:
 * `section-assignment.ts` enforces it inside a transaction on the server, and
 * the School Head's teachers table disables its picker at the same number.
 * `advisory.ts` and `section-assignment.ts` are server-side, so a client
 * component cannot reach the constant there.
 *
 * Three is a programme decision, not a data-integrity one, which is why it lives
 * in the action layer rather than in a database constraint — moving it must not
 * need a migration.
 */
export const MAX_ADVISORY_SECTIONS = 3;

/**
 * How many advisory sections this teacher may hold. The one rule the
 * transaction, the wizard and the School Head's picker all read, so the three
 * cannot disagree. A missing mode reads as DEFAULT (a profile predating the
 * column, or a read that failed).
 *
 * `MULTI_GRADE` is the stored enum value for what the product calls
 * multi-advisory. The name is historical — those sections may sit in one grade
 * or several, and nothing here assumes either.
 */
export function advisoryCapFor(
  designation: string | null | undefined,
  mode: AdvisoryMode | null | undefined
): number {
  if (designation === ARAL_VOLUNTEER_DESIGNATION) return 0;
  if (mode === "FLOATING") return 0;
  if (mode === "MULTI_GRADE") return MAX_ADVISORY_SECTIONS;
  return 1;
}

/** Why the picker stops at `advisoryCapFor`, in words a School Head can act on. */
export function advisoryCapReason(
  designation: string | null | undefined,
  mode: AdvisoryMode | null | undefined
): string {
  if (designation === ARAL_VOLUNTEER_DESIGNATION) {
    return "Non-DepEd ARAL Volunteers don't advise a section.";
  }
  if (mode === "FLOATING") return "Floating teachers don't advise a section.";
  if (mode === "MULTI_GRADE") {
    return `Multi-advisory teachers advise up to ${MAX_ADVISORY_SECTIONS} sections, in any grades.`;
  }
  return "This teacher advises one section. Set them to Multi-advisory to add more.";
}
