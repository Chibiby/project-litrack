import type { AdminChatSchool } from "@/lib/chat/queries";
import type { ChatChannelView } from "@/lib/actions/chat";
import { isActionFailure } from "@/lib/errors/client";
import type { ActionResult } from "@/lib/errors/result";
import { callAction } from "@/lib/ui/call-action";

/**
 * Chat polls, over GET instead of server actions (see
 * `src/app/api/chat/channel/route.ts` for why). Each resolves to the same
 * `ActionResult` the action would have returned, so callers keep one branch.
 */

/**
 * The `Date` fields of `ChatChannelView` and `AdminChatSchool`. A server action
 * carries Dates through; JSON turns them into ISO strings, so they are revived
 * by name. By name only: a message whose text happens to be an ISO timestamp
 * must stay text.
 */
const DATE_KEYS = new Set(["createdAt", "editedAt", "deletedAt", "readAt", "lastMessageAt", "lastOnlineAt"]);

export function reviveChatDates(key: string, value: unknown): unknown {
  if (typeof value === "string" && DATE_KEYS.has(key)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return value;
}

async function getResult<T>(url: string): Promise<ActionResult<T>> {
  return callAction(async () => {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text, reviveChatDates);
    } catch {
      body = null;
    }
    if (isActionFailure(body)) return body;
    if (response.ok && typeof body === "object" && body !== null && (body as { ok?: unknown }).ok === true) {
      return body as ActionResult<T>;
    }
    // A route error (`{ code, message }`), a sign-in redirect that came back
    // as HTML, or anything else: a failed poll the caller already tolerates.
    const routeError = body as { message?: unknown } | null;
    return {
      ok: false,
      code: "SERVER_UNREACHABLE",
      error: typeof routeError?.message === "string" ? routeError.message : "Could not load the conversation.",
    } as const;
  });
}

export function pollChannel(channelId: string): Promise<ActionResult<ChatChannelView>> {
  return getResult<ChatChannelView>(`/api/chat/channel?channelId=${encodeURIComponent(channelId)}`);
}

export function pollAdminConversations(): Promise<ActionResult<AdminChatSchool[]>> {
  return getResult<AdminChatSchool[]>("/api/chat/admin-conversations");
}
