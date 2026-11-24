import { NextResponse } from "next/server";
import { readChannel } from "@/lib/actions/chat";
import { requireUser } from "@/lib/auth/session";
import { route } from "@/lib/errors/route";

/**
 * The chat thread's poll: one channel's recent messages, as `readChannel`
 * returns them.
 *
 * A GET Route Handler, not a server action, on purpose. Server actions run one
 * at a time per browser, and middleware stamps the read-your-writes cookie on
 * every action, which makes Next re-render the whole page after it. A poll
 * through an action therefore queued a full page render every few seconds, and
 * a message typed meanwhile waited behind them. This path is under /api, which
 * middleware skips, and fetches run in parallel with the person's own actions.
 *
 * `readChannel` re-checks access (`assertChannelAccess`); the `requireUser`
 * here is the same cached per-request read.
 */

export const dynamic = "force-dynamic";

export const GET = route("GET /api/chat/channel", async (request) => {
  await requireUser();
  const channelId = request.nextUrl.searchParams.get("channelId") ?? "";
  const result = await readChannel({ channelId });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
});
