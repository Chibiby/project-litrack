/**
 * `GET /chat-ws?ticket=…` — the only way into a live chat room.
 *
 * Called from worker.js before OpenNext sees the request. The ticket was signed
 * by `openChatSocket` after `assertChannelAccess`; here it is verified again
 * (signature + 60 s expiry) and the identity it carries is the only identity
 * the room ever trusts. Relative imports only (bundled by wrangler).
 */
import { resolveTicketSecret, verifyTicket } from "./ticket";
import type { SocketIdentity } from "./room-logic";

export const IDENTITY_HEADER = "x-chat-identity";

export type DurableObjectNamespaceLike = {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
};

export type ChatSocketEnv = {
  CHAT_ROOM?: DurableObjectNamespaceLike;
  CHAT_SOCKET_SECRET?: string;
  BETTER_AUTH_SECRET?: string;
};

export async function handleChatSocket(request: Request, env: ChatSocketEnv): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return new Response("Expected a WebSocket upgrade", { status: 426 });
  }
  if (!env.CHAT_ROOM) return new Response("Not found", { status: 404 });

  const secret = resolveTicketSecret(env);
  const ticket = new URL(request.url).searchParams.get("ticket");
  const claims = secret && ticket ? await verifyTicket(ticket, secret) : null;
  if (!claims) return new Response("Unauthorized", { status: 401 });

  const identity: SocketIdentity = {
    userId: claims.u,
    displayName: claims.n,
    initials: claims.i,
    isAdmin: claims.r === "SUPER_ADMIN",
    joinedAt: Date.now(),
  };

  // Build the forwarded headers from scratch on the identity: a client-sent
  // copy of the identity header must never reach the room.
  const headers = new Headers(request.headers);
  headers.delete(IDENTITY_HEADER);
  headers.set(IDENTITY_HEADER, JSON.stringify(identity));

  const room = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(claims.c));
  return room.fetch(new Request(request.url, { method: "GET", headers }));
}
