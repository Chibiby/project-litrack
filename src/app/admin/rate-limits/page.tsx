import { requireDeveloperAdminPage } from "@/lib/auth/session";
import { AdminPage } from "@/components/admin/admin-page";
import { RateLimitsView, type RateLimitRow } from "@/components/admin/rate-limits-view";
import { readSetting } from "@/lib/settings/system-settings";
import { RATE_LIMITS_PAUSED } from "@/lib/rate-limit";
import {
  RATE_LIMITS,
  RATE_LIMITS_PAUSED_KEY,
  RATE_LIMIT_OVERRIDES_KEY,
  parseRateLimitOverrides,
  type RateLimitId,
  type RateLimitOverrides,
} from "@/lib/rate-limits/catalog";

export const dynamic = "force-dynamic";

/**
 * Developer Controls: every rate limit in LITRACK, same-network limits first,
 * and the switch that pauses them all. Reads the catalog the limits themselves
 * use, so the numbers here are the ones enforced.
 */
export default async function RateLimitsPage() {
  const user = await requireDeveloperAdminPage();

  // A failed read shows the switch as off, which is also what the limiter
  // does when it cannot read it.
  const paused = await readSetting(RATE_LIMITS_PAUSED_KEY)
    .then((v) => v === "true")
    .catch((err) => {
      console.error("[RateLimitsPage] pause switch read failed:", err);
      return false;
    });

  // A failed read shows every limit at its default, which is also what the
  // limiter enforces when it cannot read the overrides.
  const overrides = await readSetting(RATE_LIMIT_OVERRIDES_KEY)
    .then(parseRateLimitOverrides)
    .catch((err) => {
      console.error("[RateLimitsPage] overrides read failed:", err);
      return {} as RateLimitOverrides;
    });

  const rows: RateLimitRow[] = (Object.keys(RATE_LIMITS) as RateLimitId[]).map((id) => {
    const { limit, windowMs, label, description, scope, per } = RATE_LIMITS[id];
    const override = overrides[id];
    return {
      id,
      limit: override?.limit ?? limit,
      windowMs: override?.windowMs ?? windowMs,
      defaultLimit: limit,
      defaultWindowMs: windowMs,
      changed: Boolean(override),
      label,
      description,
      scope,
      per,
    };
  });

  return (
    <AdminPage
      title="Rate limits"
      description="How many attempts LITRACK allows before it asks someone to wait."
      role={user.role}
      userName={user.fullName || user.email}
    >
      <RateLimitsView rows={rows} paused={paused} codePaused={RATE_LIMITS_PAUSED} />
    </AdminPage>
  );
}
