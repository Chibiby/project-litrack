import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { DurableObjectNamespaceLike } from "./socket-route";
import type { PublishedEvent } from "./room-logic";
import { resolveTicketSecret } from "./ticket";

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

/**
 * The secret that signs socket tickets: the Worker's own env first (where
 * Cloudflare secrets live), then `process.env`. Null when neither has one,
 * which turns the live chat off rather than signing with nothing.
 */
export function chatSocketSecret(): string | null {
  let env: { CHAT_SOCKET_SECRET?: string; BETTER_AUTH_SECRET?: string } = {};
  try {
    env = getCloudflareContext().env as typeof env;
  } catch {
    // outside a Cloudflare request
  }
  return (
    resolveTicketSecret(env) ??
    resolveTicketSecret({
      CHAT_SOCKET_SECRET: process.env.CHAT_SOCKET_SECRET,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    })
  );
}
