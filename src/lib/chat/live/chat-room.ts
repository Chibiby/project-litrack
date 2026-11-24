/**
 * `ChatRoom` — one Durable Object per chat channel (`idFromName(channelId)`).
 *
 * It holds the channel's open WebSockets and nothing else: messages,
 * reactions, edits and reads live in Postgres and are written by server
 * actions, which then POST a small event here for the room to fan out. Typing
 * and presence never touch the database.
 *
 * Uses the WebSocket Hibernation API (`ctx.acceptWebSocket`), so an idle room
 * is evicted from memory and costs nothing; per-socket state lives in the
 * socket attachment, which survives hibernation.
 *
 * Plain class on purpose (no `cloudflare:workers` import): Next's typecheck and
 * tests never see workerd types. Relative imports only (bundled by wrangler,
 * exported from worker.js).
 */
import {
  ROOM_SOCKET_MAX_AGE_MS,
  TYPING_EXPIRE_MS,
  parseClientFrame,
  parseIdentity,
  parsePublishedEvent,
  presenceFor,
  typingFor,
  type RoomEvent,
  type SocketIdentity,
} from "./room-logic";
import { IDENTITY_HEADER } from "./socket-route";

type Attachment = SocketIdentity & { typingUntil: number };

type HibernatingSocket = {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
};

type RoomState = {
  acceptWebSocket(ws: HibernatingSocket): void;
  getWebSockets(): HibernatingSocket[];
  storage: {
    getAlarm(): Promise<number | null>;
    setAlarm(when: number): Promise<void>;
  };
};

declare const WebSocketPair: new () => { 0: HibernatingSocket; 1: HibernatingSocket };

/** How often the room checks for expired typing and over-age sockets. */
const SWEEP_MS = 30_000;

function attachmentOf(ws: HibernatingSocket): Attachment | null {
  const value = ws.deserializeAttachment() as Attachment | null;
  return value && typeof value.userId === "string" ? value : null;
}

function safeSend(ws: HibernatingSocket, event: RoomEvent): void {
  try {
    ws.send(JSON.stringify(event));
  } catch {
    // A socket closing mid-broadcast is normal; the close handler tidies up.
  }
}

export class ChatRoom {
  private readonly ctx: RoomState;

  constructor(ctx: RoomState) {
    this.ctx = ctx;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/publish") {
      let body: unknown = null;
      try {
        body = await request.json();
      } catch {
        // invalid body → 400 below
      }
      const event = parsePublishedEvent(body);
      if (!event) return new Response("Bad event", { status: 400 });
      for (const ws of this.ctx.getWebSockets()) safeSend(ws, event);
      return new Response(null, { status: 204 });
    }

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Not found", { status: 404 });
    }
    // Set by worker.js from a verified ticket; the room has no public route.
    const identity = parseIdentity(request.headers.get(IDENTITY_HEADER));
    if (!identity) return new Response("Unauthorized", { status: 401 });

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ ...identity, typingUntil: 0 } satisfies Attachment);
    this.broadcastPresence();
    this.broadcastTyping();
    await this.ensureAlarm();

    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: unknown });
  }

  async webSocketMessage(ws: HibernatingSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    const frame = parseClientFrame(message);
    const me = attachmentOf(ws);
    if (!frame || !me) return;

    if (frame.type === "ping") {
      ws.send('{"type":"pong"}');
      return;
    }
    const typingUntil = frame.on ? Date.now() + TYPING_EXPIRE_MS : 0;
    // A "stopped typing" from someone not typing changes nothing; skip the broadcast.
    if (!frame.on && me.typingUntil <= Date.now()) return;
    ws.serializeAttachment({ ...me, typingUntil } satisfies Attachment);
    this.broadcastTyping();
    if (frame.on) await this.ensureAlarm();
  }

  async webSocketClose(ws: HibernatingSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "closing");
    } catch {
      // already closed
    }
    this.broadcastPresence(ws);
    this.broadcastTyping(ws);
  }

  async webSocketError(ws: HibernatingSocket): Promise<void> {
    await this.webSocketClose(ws, 1011);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    let typingChanged = false;
    for (const ws of this.ctx.getWebSockets()) {
      const a = attachmentOf(ws);
      if (!a) continue;
      if (now - a.joinedAt > ROOM_SOCKET_MAX_AGE_MS) {
        // 4001: "re-authorize". The client reconnects with a fresh ticket.
        try {
          ws.close(4001, "reauthorize");
        } catch {
          // ignore
        }
        continue;
      }
      if (a.typingUntil && a.typingUntil <= now) {
        ws.serializeAttachment({ ...a, typingUntil: 0 } satisfies Attachment);
        typingChanged = true;
      }
    }
    if (typingChanged) this.broadcastTyping();
    if (this.ctx.getWebSockets().length > 0) await this.ctx.storage.setAlarm(now + SWEEP_MS);
  }

  private live(except?: HibernatingSocket): { ws: HibernatingSocket; a: Attachment }[] {
    const out: { ws: HibernatingSocket; a: Attachment }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const a = attachmentOf(ws);
      if (a) out.push({ ws, a });
    }
    return out;
  }

  private broadcastPresence(except?: HibernatingSocket): void {
    const sockets = this.live(except);
    const everyone = sockets.map((s) => s.a);
    for (const { ws, a } of sockets) safeSend(ws, { type: "presence", userIds: presenceFor(a, everyone) });
  }

  private broadcastTyping(except?: HibernatingSocket): void {
    const now = Date.now();
    const sockets = this.live(except);
    const typing = sockets.map((s) => s.a).filter((a) => a.typingUntil > now);
    for (const { ws, a } of sockets) safeSend(ws, { type: "typing", ...typingFor(a, typing) });
  }

  private async ensureAlarm(): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null) await this.ctx.storage.setAlarm(Date.now() + SWEEP_MS);
  }
}
