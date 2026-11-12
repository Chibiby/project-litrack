import "server-only";

import { getGateForUser } from "@/lib/school-year/gate";
import type { HeaderSchoolYearGate } from "@/components/shell/school-year-badge";

/**
 * The header badge's gate, for a role layout to pass to `RoleShell` without
 * awaiting. Never rejects: a failed read hides the badge rather than taking the
 * shell down with it (the write guards still refuse on their own).
 */
export function loadHeaderSchoolYearGate(user: {
  schoolId: string | null;
}): Promise<HeaderSchoolYearGate | null> {
  return getGateForUser(user)
    .then((g) => ({
      open: g.open,
      reason: g.reason,
      isLastMonth: g.isLastMonth,
      label: g.label,
      activeStart: g.activeStart,
      activeEnd: g.activeEnd,
    }))
    .catch((err: unknown) => {
      console.error("[school-year] header gate failed:", err);
      return null;
    });
}
