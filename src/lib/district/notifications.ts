import "server-only";
import { cache } from "react";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { schoolWhereForScope, scopeCacheKey, type AdminScope } from "@/lib/auth/admin-scope";
import { cachedQuery } from "@/lib/cache/unstable";
import { supportInbox } from "@/lib/cache/tags";
import { DISTRICT_ROUTES } from "@/lib/routes/district";
import type { ShellNotification } from "@/components/shell/notifications-menu";

/**
 * The district (and division-summary) header bell's derived alert.
 *
 * NOT a fan-out of `Notification` rows (spec 13.F): nothing renders
 * `SUPPORT_TICKET_SUBMITTED` rows even for a Super Admin today
 * (`src/app/admin/layout.tsx` passes only `getChatNotifications`), so writing
 * a second, unread mechanism nobody clears would only grow stale. A COUNT of
 * open tickets in the caller's own scope is smaller and cannot go stale the
 * way a fan-out could — the next open/resolve/decline busts the same
 * `supportInbox` tag `revalidateSupportTicket` already uses.
 *
 * Cached under `scopeCacheKey`, the same rule every scoped read in
 * `docs/specs/district-admin.md` follows (I9): two admins with different
 * district assignments never share a cache entry, and the same admin's count
 * never serves stale after a ticket in their own scope changes state.
 *
 * The release-update alert is not part of this: `NotificationsMenu`
 * (`src/components/shell/notifications-menu.tsx`) already renders the release
 * history for every role straight from the committed `RELEASES` list, and
 * `RoleShell`'s `lastSeenReleaseVersion` prop (read directly off the signed-in
 * `User` row, the same as every other role) drives the "what's new" modal —
 * neither needs a query from here.
 *
 * Called once from `layout.tsx` (the header bell) and again from the page's
 * `AttentionRail` in the same request — layout and page each hold their own
 * `AdminScope` object, and even where the underlying assignments are
 * identical they are not the same object, so a `cache()`-wrapped function
 * keyed on `scope` itself would miss both times. Instead a single per-request
 * `Map` (its factory is the only thing wrapped in `cache()`, so React only
 * dedupes a zero-arg call) is keyed on `user.id` + `scopeCacheKey` alone —
 * primitives that fully determine the count, same as the `cachedQuery` key
 * below.
 */
const getRequestMemo = cache(() => new Map<string, Promise<number>>());

export async function getDistrictNotifications(
  user: Pick<User, "id">,
  scope: AdminScope
): Promise<ShellNotification[]> {
  const key = `${user.id}|${scopeCacheKey(scope, false)}`;
  const memo = getRequestMemo();
  let pending = memo.get(key);
  if (!pending) {
    pending = cachedQuery(() => countOpenTicketsInScope(scope), {
      // `user.id` plays no part in the count — two district admins over the same
      // districts see the same number — but it is part of the key anyway so a
      // future per-admin narrowing (e.g. "assigned to me") does not silently
      // start serving one admin's entry to another.
      keyParts: ["district-notifications", "open-tickets", "v1", key],
      tags: [supportInbox],
    });
    memo.set(key, pending);
  }

  const count = await pending;
  if (count === 0) return [];

  return [
    {
      id: "district-open-tickets",
      title:
        count === 1
          ? "1 support request needs an answer"
          : `${count} support requests need an answer`,
      description: "From schools in your districts.",
      href: DISTRICT_ROUTES.support,
      tone: "amber",
    },
  ];
}

async function countOpenTicketsInScope(scope: AdminScope): Promise<number> {
  return prisma.supportTicket.count({
    where: {
      status: { in: ["OPEN", "IN_PROGRESS"] },
      school: schoolWhereForScope(scope),
    },
  });
}
