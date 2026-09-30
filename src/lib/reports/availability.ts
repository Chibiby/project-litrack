/**
 * Which Reports Hub kinds this account cannot run, and why.
 *
 * Pure and client-safe: the hub greys the locked cards and chips out with the
 * reason, and `generateReport` refuses the same kinds server-side, so both read
 * one map rather than two copies of the rule.
 *
 * The input is `advisoryRosterDenial` (`src/lib/teachers/scope.ts`), the one
 * tested predicate for "this teacher advises no section". A Non-DepEd ARAL
 * Volunteer and a FLOATING DepEd teacher both have no end-of-term sheet, so the
 * grades report has nothing to cover for them. Their ARAL work (attendance,
 * reading levels) stays open. MOSY does NOT: it is the DepEd adviser's report,
 * so `generateReport` refuses the MOSY kind for them through `resolveMosyAccess`
 * (`src/lib/aral/mosy-access.ts`), which also covers a DepEd teacher with no
 * advisory section. That check needs a database read, so it is not in this pure
 * map and the hub cannot grey the MOSY card out from here.
 */

import type { ReportKind } from "@prisma/client";
import type { AdvisoryRosterDenial } from "@/lib/teachers/scope";

/** Locked kind → the sentence shown on the disabled card and in the refusal. */
export type ReportLocks = Partial<Record<ReportKind, string>>;

const VOLUNTEER_GRADES =
  "End of Term grades are for DepEd teachers who advise a section.";
const FLOATING_GRADES =
  "Floating teachers do not advise a section, so there are no term grades to report.";

export function reportLocksFor(denial: AdvisoryRosterDenial): ReportLocks {
  if (denial === "volunteer") return { TERM_GRADES: VOLUNTEER_GRADES };
  if (denial === "floating") return { TERM_GRADES: FLOATING_GRADES };
  return {};
}
