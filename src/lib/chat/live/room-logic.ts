/**
 * The rules a live chat room applies, kept apart from the Durable Object so
 * they can be tested in Node. Relative imports only (bundled by wrangler).
 *
 * Owner decision 2026-11-24: a Super Admin never shows as connected or typing
 * to a non-admin viewer. Every per-viewer frame goes through the two filters
 * below, so that rule lives in one place.
 */

export type SocketIdentity = {
  userId: string;
  displayName: string;
  initials: string;
  isAdmin: boolean;
  /** Epoch ms, for the 10-minute re-authorization close. */
  joinedAt: number;
};

/** Server → client frames. */
export type RoomEvent =
  | {
      type: "message.created" | "message.updated" | "reaction.changed" | "read.changed";
      messageId?: string;
      userId?: string;
      at: string;
    }
  | { type: "typing"; userIds: string[]; names: string[] }
  | { type: "presence"; userIds: string[] };

export type PublishedEvent = Extract<RoomEvent, { at: string }>;

/** Client → room frames. Anything else is ignored. */
export type ClientFrame = { type: "typing"; on: boolean } | { type: "ping" };

/**
 * Sockets older than this are closed. The client reconnects with a fresh
 * ticket, which re-runs `assertChannelAccess`, so a removed member loses the
 * live feed within this window.
 */
export const ROOM_SOCKET_MAX_AGE_MS = 10 * 60_000;

/** A typing flag with no refresh for this long is dropped. */
export const TYPING_EXPIRE_MS = 6_000;

const MAX_FRAME_CHARS = 512;

function visibleTo(viewer: SocketIdentity, other: SocketIdentity): boolean {
  if (other.userId === viewer.userId) return false;
  if (other.isAdmin && !viewer.isAdmin) return false;
  return true;
}

/** User ids this viewer may see as connected (unique, self and hidden admins removed). */
export function presenceFor(viewer: SocketIdentity, all: SocketIdentity[]): string[] {
  const ids = new Set<string>();
  for (const other of all) if (visibleTo(viewer, other)) ids.add(other.userId);
  return [...ids];
}

/** Who this viewer may see typing, with names in the same order. */
export function typingFor(
  viewer: SocketIdentity,
  typing: SocketIdentity[]
): { userIds: string[]; names: string[] } {
  const userIds: string[] = [];
  const names: string[] = [];
  for (const other of typing) {
    if (!visibleTo(viewer, other) || userIds.includes(other.userId)) continue;
    userIds.push(other.userId);
    names.push(other.displayName);
  }
  return { userIds, names };
}

export function parseClientFrame(raw: string): ClientFrame | null {
  if (typeof raw !== "string" || raw.length > MAX_FRAME_CHARS) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const frame = value as Record<string, unknown>;
  if (frame.type === "ping") return { type: "ping" };
  if (frame.type === "typing" && typeof frame.on === "boolean") return { type: "typing", on: frame.on };
  return null;
}

const PUBLISHED_TYPES = new Set(["message.created", "message.updated", "reaction.changed", "read.changed"]);

/** A server publish body, or null. Only these four types may be published. */
export function parsePublishedEvent(value: unknown): PublishedEvent | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Record<string, unknown>;
  if (typeof e.type !== "string" || !PUBLISHED_TYPES.has(e.type) || typeof e.at !== "string") return null;
  if (e.messageId !== undefined && typeof e.messageId !== "string") return null;
  if (e.userId !== undefined && typeof e.userId !== "string") return null;
  return {
    type: e.type as PublishedEvent["type"],
    at: e.at,
    ...(e.messageId ? { messageId: e.messageId as string } : {}),
    ...(e.userId ? { userId: e.userId as string } : {}),
  };
}

export function parseIdentity(raw: string | null): SocketIdentity | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof v.userId === "string" &&
      typeof v.displayName === "string" &&
      typeof v.initials === "string" &&
      typeof v.isAdmin === "boolean" &&
      typeof v.joinedAt === "number"
    ) {
      return { userId: v.userId, displayName: v.displayName, initials: v.initials, isAdmin: v.isAdmin, joinedAt: v.joinedAt };
    }
  } catch {
    // fall through
  }
  return null;
}
