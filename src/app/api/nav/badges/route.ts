import { NextResponse } from "next/server";
import { requireAdminScope } from "@/lib/auth/district-scope";
import { route } from "@/lib/errors/route";
import { getAdminNavBadges, getDistrictNavBadges } from "@/lib/nav/badges";
import type { NavBadges } from "@/lib/nav/nav-config";

/**
 * The admin consoles' 30 s poll of the Support badge, so a new school concern
 * shows in the side menu without a page change. A GET Route Handler, not a
 * server action, for the reason in `../../chat/channel/route.ts`: an action
 * poll would re-render the whole page and queue ahead of the admin's own work.
 * Every other badge refreshes on navigation only (spec: approach C).
 */

export const dynamic = "force-dynamic";

export const GET = route("GET /api/nav/badges", async () => {
  const { user, scope } = await requireAdminScope();
  const data: NavBadges =
    user.role === "SUPER_ADMIN" ? await getAdminNavBadges() : await getDistrictNavBadges(user, scope);
  return NextResponse.json({ ok: true, data }, { headers: { "Cache-Control": "no-store" } });
});
