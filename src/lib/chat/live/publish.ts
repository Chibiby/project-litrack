import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { DurableObjectNamespaceLike } from "./socket-route";
import type { PublishedEvent } from "./room-logic";

/**
 * Tell a channel's live room that something changed, after the write has
 * committed. Best effort by design: Postgres already holds the change, and
 * every client also polls, so a failed publish only means the change arrives
 * on the next poll instead of at once. It must never fail the action.
 */

function chatRoomBinding(): DurableObjectNamespaceLike | null {
  try {
    const { env } = getCloudflareContext();
    return (env as { CHAT_ROOM?: DurableObjectNamespaceLike }).CHAT_ROOM ?? null;
  } catch {
    // Outside a Cloudflare request (next dev, tests, build).
    return null;
  }
}

export function hasChatRoomBinding(): boolean {
  return chatRoomBinding() !== null;
}

export async function publishRoomEvent(channelId: string, event: PublishedEvent): Promise<void> {
  const binding = chatRoomBinding();
  if (!binding) return;
  try {
    const room = binding.get(binding.idFromName(channelId));
    const response = await room.fetch(
      new Request("https://room/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(event),
      })
    );
    if (!response.ok) console.warn("[chat] publish failed", channelId, response.status);
  } catch {
    console.warn("[chat] publish failed", channelId, "error");
  }
}
