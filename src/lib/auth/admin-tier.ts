import type { AdminTier, UserRole } from "@prisma/client";

/**
 * Super Admin tiers. Both tiers see the same division-wide pages; only a
 * Developer Admin sees Developer Controls (audit log, error log, Page Test Lab,
 * archived records, database console, demo data).
 *
 * Pure — no Prisma client, no `server-only` — so the nav, the shell and tests
 * can all share it.
 */
export function isDeveloperAdmin(user: { role: UserRole; adminTier: AdminTier | null }): boolean {
  // A null tier on a Super Admin reads as DIVISION: a new admin never gets
  // Developer Controls by omission.
  return user.role === "SUPER_ADMIN" && user.adminTier === "DEVELOPER";
}

/** What a Super Admin is called in the account menu. */
export function superAdminLabel(user: { role: UserRole; adminTier: AdminTier | null }): string {
  return isDeveloperAdmin(user) ? "Developer Admin" : "Division Admin";
}
