"use server";

import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { APP_VERSION } from "@/lib/releases";
import { action } from "@/lib/errors/action";

/**
 * Stamp the version this user just read.
 *
 * Called from the modal's "Got it" — on acknowledgement, never on display. A
 * user who sees the modal and closes the tab mid-sentence has not read it and
 * will be shown it again. Writing the stamp when the modal mounts would swallow
 * the announcement for exactly the person interrupted at the wrong moment.
 *
 * A failure IS surfaced: without the stamp the modal reappears on the next
 * navigation, and someone who pressed "Got it" and is interrupted again should
 * be told why rather than left thinking it broke.
 *
 * No audit row: an audit row records a decision somebody made about somebody
 * else's data, and "a user read the release notes" is neither.
 *
 * This is the only write the release channel makes. The bell's release history
 * is derived from the committed `RELEASES` list, so it needs no stored rows.
 * `RELEASE_PUBLISHED` notification rows written before 1.6.0 are no longer read.
 */
export const acknowledgeRelease = action(
  "acknowledgeRelease",
  async (): Promise<{ ok: true }> => {
    const user = await requireUser();

    await prisma.user.update({
      where: { id: user.id },
      data: { lastSeenReleaseVersion: APP_VERSION },
    });

    return { ok: true };
  },
  { verb: "save that you have seen this" }
);
