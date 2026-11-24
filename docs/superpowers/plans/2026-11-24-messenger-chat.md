# Messenger-style Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn LITRACK's polled chat into a live, messenger-style chat (reactions, replies, edit/delete, typing, seen, presence) with polling as the fallback.

**Architecture:** Postgres stays the only store; every write is a wrapped server action through `assertChannelAccess`, which then best-effort publishes an event to a per-channel Cloudflare Durable Object (`ChatRoom`, hibernation WebSockets). Clients join a room with a 60 s HMAC ticket from `openChatSocket`; `worker.js` verifies it before OpenNext. Without the binding (local dev) or after 3 socket failures the client keeps today's adaptive polling.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 6 on Neon, OpenNext on Cloudflare Workers (wrangler 4.131), Durable Objects (SQLite class, hibernation API), Web Crypto, Tailwind + shadcn/ui, Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-24-messenger-chat-design.md`

## Global Constraints

- Repo: `C:\Users\PC5\Desktop\litrack-district-summary`, branch `feat/district-summary-scope`. Commit after each task; stage only that task's files.
- Gates before done: `npx prisma generate`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, with placeholder `DATABASE_URL`/`DIRECT_URL` exported.
- Migration is additive only. Name `20261124000002_chat_messenger`. Apply to prod only with owner approval, after `prisma migrate status`, before the code push.
- Six reaction emoji, in this order: `👍 ❤️ 😂 😮 😢 🙏`.
- Grouping window 5 min. Edit window 15 min. Ticket TTL 60 s. Room closes every socket after 10 min. Read marker writes at most once per 5 s per channel. Support Inbox list refresh 10 s.
- Own bubble `bg-primary text-primary-foreground`; others `bg-muted`. No violet (`aral*`) in chat bubbles.
- Super Admin is never shown as online, connected, typing, or in "Seen by" to a non-admin viewer.
- Delete blanks `body` to `""`, sets `deletedAt`, removes its reactions and mention rows. UI text: "Message removed".
- No message text in audit metadata or in logs. Admin delete is audited as `CHAT_MESSAGE_MODERATE` and must be in `SECURITY_AUDIT_ACTIONS`.
- Files that `worker.js` imports (ticket, room) use relative imports only — wrangler does not resolve `@/`.
- No new npm dependencies.
- Release: 2.85.0 (feature) in `src/lib/releases.ts`, `package.json`, `package-lock.json` (both version fields).
- Touch targets 44 px on touch, 36 px desktop. Dark mode via tokens only.

## Review Focus

1. A non-admin viewer receives a `presence` or `typing` frame that includes a Super Admin socket — expect it filtered out (Task 4 test `filters super admin from non-admin viewers`).
2. A ticket for channel A replayed to join channel B, or used after 60 s, or with a flipped byte — expect 401 (Task 3 tests).
3. `replyToId` pointing at a message in another channel (another school) — expect `NOT_FOUND`, no quote leak (Task 6 test `refuses a reply to another channel's message`).
4. Editing someone else's message, a deleted message, or after 15 min — expect refusal (Task 6 tests).
5. Socket unavailable (`openChatSocket` returns `{ live: false }`, or the socket errors 3 times) — chat still loads, sends and polls (Task 7 test `falls back to polling`).

---

### Task 1: Data model and migration

**Files:**
- Modify: `prisma/schema.prisma` (ChatMessage, new ChatReaction, User relation)
- Create: `prisma/migrations/20261124000002_chat_messenger/migration.sql`
- Modify: `prisma/rls-policies.sql` (enable RLS on `ChatReaction`)
- Modify: `src/lib/db/schema-order.ts` (add ChatReaction after ChatMention)
- Modify: `src/lib/archive/purge.ts` (count `chatReaction` by `userId`)
- Test: `tests/unit/db/schema-order.test.ts` (existing; must pass unchanged)

**Interfaces:**
- Produces: Prisma `ChatReaction { id, messageId, userId, emoji, createdAt }` with `@@unique([messageId, userId, emoji])`, `@@index([messageId])`, cascade on message and user. `ChatMessage.replyToId String?` (self relation `ChatReply`, `onDelete: SetNull`, `@@index([replyToId])`), `ChatMessage.editedAt DateTime?`, `ChatMessage.reactions ChatReaction[]`.

- [ ] **Step 1:** Edit the schema. Run `npx prisma format` on `prisma/schema.prisma` only, then `npx prisma validate`. Expected: "The schema at prisma/schema.prisma is valid".
- [ ] **Step 2:** Write the HEAD schema to the scratchpad (`git show HEAD:prisma/schema.prisma > <scratch>/schema-head.prisma`), then `npx prisma migrate diff --from-schema-datamodel <scratch>/schema-head.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/20261124000002_chat_messenger/migration.sql`. Expected statements: `CREATE TABLE "ChatReaction"`, its unique and index, two FKs `ON DELETE CASCADE`, `ALTER TABLE "ChatMessage" ADD COLUMN "replyToId" TEXT, ADD COLUMN "editedAt" TIMESTAMP(3)`, index on `replyToId`, FK `ON DELETE SET NULL`. Nothing else (no DROP, no ALTER of existing columns).
- [ ] **Step 3:** Prepend the header comment (additive only, spec path) and append `ALTER TABLE "ChatReaction" ENABLE ROW LEVEL SECURITY;`.
- [ ] **Step 4:** Add the schema-order entry `{ model: "ChatReaction", delegate: "chatReaction", operational: true, schoolScope: (schoolId) => ({ message: { channel: { schoolId } } }) }` after ChatMention; add `chatReaction` to the purge counts type and query.
- [ ] **Step 5:** `npx prisma generate && npx vitest run tests/unit/db`. Expected: PASS.
- [ ] **Step 6:** Commit `feat(chat): reactions, replies and edits in the data model`.

### Task 2: Pure view helpers

**Files:**
- Create: `src/lib/chat/view.ts`
- Test: `tests/unit/chat/view.test.ts`

**Interfaces:**
- Produces:
  - `REACTION_EMOJI: readonly ["👍","❤️","😂","😮","😢","🙏"]`, `type ReactionEmoji`.
  - `REACTION_LABELS: Record<ReactionEmoji, string>` — "thumbs up", "heart", "laugh", "wow", "sad", "thank you".
  - `GROUP_WINDOW_MS = 300_000`, `EDIT_WINDOW_MS = 900_000`.
  - `groupMessages<T extends { id; authorId; createdAt: Date }>(rows: T[]): { authorId: string; dayKey: string; items: T[] }[]` — new group when author changes, day changes (`formatLocalDateKey`), or gap > 5 min.
  - `canEditMessage(msg: { authorId; createdAt: Date; deletedAt: Date | null }, viewerId: string, now: Date): boolean`.
  - `typingLabel(names: string[]): string | null` — `null`, "Ana is typing…", "Ana and Ben are typing…", "3 people are typing…".
  - `seenLabel(kind: "SCHOOL" | "ADMIN_DIRECT", readers: { name: string; readAt: Date }[]): string | null` — school: "Seen by Ana", "Seen by Ana, Ben", "Seen by Ana, Ben +2"; admin line: "Seen 2:14 PM" (latest readAt, `Intl` hour/minute).
  - `previewLine(msg: { body; deletedAt; authorId; authorFirstName }, viewerId): string` — "You: …", "Ana: …", "Message removed"; first line, max 80 chars with "…".

- [ ] **Step 1:** Write tests: `groups a burst within 5 minutes`, `splits at a 6-minute gap`, `splits on author change and on day change`, `allows edit at 14:59 and refuses at 15:01`, `refuses edit of another author or a deleted message`, typing label four cases, seen label for both kinds incl. `+2`, preview for self/other/deleted/long.
- [ ] **Step 2:** `npx vitest run tests/unit/chat/view.test.ts` — FAIL (module missing).
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run — PASS. Commit `feat(chat): grouping, seen, typing and edit-window helpers`.

### Task 3: Socket ticket

**Files:**
- Create: `src/lib/chat/live/ticket.ts` (relative imports only; Web Crypto only, runs in Node and workerd)
- Test: `tests/unit/chat/ticket.test.ts`

**Interfaces:**
- Produces:
  - `type TicketClaims = { c: string; u: string; n: string; i: string; r: "SUPER_ADMIN" | "MEMBER"; exp: number }` (`exp` in epoch ms).
  - `TICKET_TTL_MS = 60_000`.
  - `signTicket(claims: Omit<TicketClaims,"exp">, secret: string, now?: number): Promise<string>` — `base64url(JSON).base64url(HMAC-SHA256)`.
  - `verifyTicket(ticket: string, secret: string, now?: number): Promise<TicketClaims | null>` — null on bad shape, bad signature (constant-time via `crypto.subtle.verify`), or `now > exp`.
  - `resolveTicketSecret(env: { CHAT_SOCKET_SECRET?: string; BETTER_AUTH_SECRET?: string }): string | null`.

- [ ] **Step 1:** Tests: `round-trips claims`, `rejects after 60 s`, `rejects a flipped signature byte`, `rejects a payload edited to another channel`, `rejects a different secret`, `rejects garbage`, `secret falls back to BETTER_AUTH_SECRET, null when both unset or blank`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run — PASS. Commit `feat(chat): signed socket tickets`.

### Task 4: Chat room Durable Object and worker route

**Files:**
- Create: `src/lib/chat/live/room-logic.ts` (pure, relative imports)
- Create: `src/lib/chat/live/chat-room.ts` (the DO class; plain class, no `cloudflare:workers` import; minimal local types for `ctx.acceptWebSocket`, `ctx.getWebSockets`, `serializeAttachment`)
- Create: `src/lib/chat/live/socket-route.ts` — `handleChatSocket(request, env)`
- Modify: `worker.js` (intercept `/chat-ws`, `export { ChatRoom }`)
- Modify: `wrangler.jsonc` (`durable_objects.bindings: [{ name: "CHAT_ROOM", class_name: "ChatRoom" }]`, `migrations: [{ tag: "v1-chat-room", new_sqlite_classes: ["ChatRoom"] }]`)
- Test: `tests/unit/chat/room-logic.test.ts`, `tests/unit/chat/socket-route.test.ts`

**Interfaces:**
- Consumes: `verifyTicket`, `resolveTicketSecret` (Task 3).
- Produces:
  - `type SocketIdentity = { userId; displayName; initials; isAdmin: boolean; joinedAt: number }`.
  - `type RoomEvent = { type: "message.created" | "message.updated" | "reaction.changed" | "read.changed"; messageId?: string; userId?: string; at: string } | { type: "typing"; userIds: string[]; names: string[] } | { type: "presence"; userIds: string[] }`.
  - `presenceFor(viewer: SocketIdentity, all: SocketIdentity[]): string[]` — unique user ids, excluding the viewer, excluding admins when `!viewer.isAdmin`.
  - `typingFor(viewer, typing: SocketIdentity[]): { userIds; names }` — same filter.
  - `parseClientFrame(raw: string): { type: "typing"; on: boolean } | { type: "ping" } | null` — anything else is null and ignored.
  - `ROOM_SOCKET_MAX_AGE_MS = 600_000`, `TYPING_EXPIRE_MS = 6_000`.
  - `ChatRoom` methods: `fetch(req)` — upgrade (identity from `x-chat-identity` header set by the worker) or `POST /publish` (JSON `RoomEvent`, broadcast to all sockets); `webSocketMessage`, `webSocketClose`, `alarm` (close sockets older than 10 min, expire typing).
  - `handleChatSocket(request: Request, env: { CHAT_ROOM?: DurableObjectNamespaceLike; CHAT_SOCKET_SECRET?; BETTER_AUTH_SECRET? }): Promise<Response>` — 426 if not an upgrade, 404 if no binding, 401 if ticket invalid, else forwards to `CHAT_ROOM.get(CHAT_ROOM.idFromName(claims.c))` with `x-chat-identity` (strip any client-sent copy first).

- [ ] **Step 1:** Tests: `filters super admin from non-admin viewers` (presence and typing), `admins see everyone`, `viewer never sees self`, `dedupes two tabs of one user`, `parseClientFrame ignores unknown types and bad JSON`; route: `401 on missing/expired/forged ticket`, `404 without binding`, `426 without Upgrade header`, `forwards to the room named by the ticket channel`, `drops a client-supplied x-chat-identity header`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement logic, DO and route; in `worker.js` add `if (new URL(request.url).pathname === "/chat-ws") return handleChatSocket(request, env);` inside a `fetch` wrapper around `worker.fetch`, and `export { ChatRoom } from "./src/lib/chat/live/chat-room.ts";`.
- [ ] **Step 4:** Run — PASS. `npm run typecheck` — 0 errors. Commit `feat(chat): ChatRoom durable object and socket route`.

### Task 5: Publish helper

**Files:**
- Create: `src/lib/chat/live/publish.ts` (`server-only`)
- Test: `tests/unit/chat/publish.test.ts`

**Interfaces:**
- Consumes: `RoomEvent` (Task 4).
- Produces: `publishRoomEvent(channelId: string, event: RoomEvent): Promise<void>` — gets `env.CHAT_ROOM` via `getCloudflareContext()` in try/catch; no binding → return; POSTs `https://room/publish`; any throw or non-2xx → `console.warn("[chat] publish failed", channelId, status)` and return. Never throws. `hasChatRoomBinding(): boolean`.

- [ ] **Step 1:** Tests: `no-op outside Cloudflare`, `posts to the channel's room`, `swallows a throwing stub`, `swallows a 500`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(chat): best-effort room publish`.

### Task 6: Server actions

**Files:**
- Modify: `src/lib/actions/chat.ts`
- Modify: `src/lib/validators/chat.schema.ts`
- Modify: `src/lib/audit-actions.ts` (`CHAT_MESSAGE_MODERATE`, in `SECURITY_AUDIT_ACTIONS`)
- Test: `tests/unit/actions/chat-access.test.ts` (extend), create `tests/unit/actions/chat-messenger.test.ts`

**Interfaces:**
- Consumes: `publishRoomEvent`, `hasChatRoomBinding` (Task 5), `signTicket`, `resolveTicketSecret` (Task 3), `canEditMessage`, `REACTION_EMOJI` (Task 2).
- Produces (types exported from `chat.ts`):
  - `ChatMessageView` gains `authorId: string`, `editedAt: Date | null`, `deleted: boolean` (body `""` when deleted), `replyTo: { id; authorName; excerpt; deleted: boolean } | null`, `reactions: { emoji: ReactionEmoji; userIds: string[]; names: string[] }[]`.
  - `ChatChannelView` gains `viewerId: string`, `viewerIsAdmin: boolean`, `readers: { userId; name; readAt: Date }[]` (others' markers; admins removed for non-admin viewers), `members: { userId; name; initials; lastOnlineAt: Date | null }[]` (admins removed for non-admin viewers; SCHOOL = active school users, cap 100; ADMIN_DIRECT = the member, plus admins only for admin viewers).
  - Keep `author.isSelf` for existing callers.
  - Schemas: `sendChatMessageSchema` + `replyToId: uuid().optional()`; `editChatMessageSchema { messageId, body }`; `deleteChatMessageSchema { messageId }`; `toggleChatReactionSchema { messageId, emoji: z.enum(REACTION_EMOJI) }`; `openChatSocketSchema { channelId }`.
  - Actions (all `action()`-wrapped, `requireUser` first, message → its channel → `assertChannelAccess`):
    - `readChannel` — includes deleted rows as removed; never selects `body` of deleted rows into the view.
    - `sendChatMessage` — `replyToId` must belong to the same channel and not be deleted, else `resourceNotFound("Message")`; publishes `message.created`.
    - `editChatMessage` → `{ ok: true }` — author only; `canEditMessage` false → `AppError("VALIDATION_FAILED", { detail: "This message can no longer be edited" })`; sets `body`, `editedAt`; resolves only new mentions and notifies them (`CHAT_MENTION`); shares the `chat:${user.id}` rate limit; publishes `message.updated`.
    - `deleteChatMessage` → `{ ok: true }` — author, or Super Admin; one transaction: `body: ""`, `deletedAt: now`, delete reactions and mentions; admin deleting another's message writes `CHAT_MESSAGE_MODERATE` audit (ids only); publishes `message.updated`.
    - `toggleChatReaction` → `{ ok: true, data: { on: boolean } }` — refuses deleted messages; create or delete the unique row; shares the rate limit; publishes `reaction.changed`.
    - `markChannelRead` — publishes `read.changed` (with `userId`) only when the reader is not a Super Admin, so an admin's read never reaches a member's socket; clients refetch on it.
    - `openChatSocket` → `{ ok: true, data: { live: false } | { live: true; ticket: string; url: "/chat-ws" } }` — `live: false` when no binding or no secret.

- [ ] **Step 1:** Tests, one per behavior: `each new action refuses another school's channel as NOT_FOUND` (edit, delete, react, openChatSocket), `refuses a reply to another channel's message`, `refuses editing another author's message`, `refuses editing after 15 minutes`, `refuses editing a deleted message`, `delete blanks body and removes reactions and mentions in one transaction`, `super admin may delete any message and it is audited without text`, `teacher may not delete another's message`, `toggle adds then removes`, `rejects an emoji outside the six`, `readChannel hides super admin from members and readers for a teacher`, `readChannel shows super admin to an admin`, `deleted message view has empty body and deleted true`, `openChatSocket returns live false without binding`, `openChatSocket ticket carries channel, user and admin flag`, `edit notifies only newly added mentions`, `super admin read publishes nothing`.
- [ ] **Step 2:** Run both files — new tests FAIL, existing pass.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npx vitest run tests/unit/actions tests/unit/chat` — PASS. Commit `feat(chat): edit, delete, react, reply and live tickets`.

### Task 7: `useChatLive` hook

**Files:**
- Create: `src/components/chat/use-chat-live.ts`
- Test: `tests/components/use-chat-live.test.tsx`

**Interfaces:**
- Consumes: `openChatSocket` (Task 6), `RoomEvent` (Task 4), `chatPollDelayMs` (existing, moves here and is re-exported from `chat-thread.tsx` so `tests/unit/chat-poll-delay.test.ts` keeps its import).
- Produces: `useChatLive(channelId: string | null, onChange: (e: RoomEvent) => void): { live: boolean; typingUserIds: string[]; typingNames: string[]; onlineUserIds: string[]; sendTyping(on: boolean): void }`. Behavior: ticket → `new WebSocket(wss origin + url + ?ticket=)`; on close reconnect with a new ticket (backoff 1 s, 3 s, 10 s); after 3 consecutive failures stop and report `live: false`; `sendTyping` throttled to one frame per 3 s, stop sent on blur/send. Owner component keeps polling: `live` true → 60 s, else `chatPollDelayMs`.

- [ ] **Step 1:** Tests with a fake `WebSocket` global: `falls back to polling when ticket says live false`, `falls back after three socket errors`, `reconnects with a fresh ticket after close`, `forwards message events to onChange`, `exposes typing names from frames`, `throttles typing frames`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(chat): live socket hook with polling fallback`.

### Task 8: Messenger UI and ChatThread

**Files:**
- Create in `src/components/chat/`: `message-bubble.tsx`, `message-group.tsx`, `reaction-bar.tsx`, `reaction-chips.tsx`, `typing-indicator.tsx`, `seen-line.tsx`, `emoji-picker.tsx`, `chat-composer.tsx`, `message-scroller.tsx`
- Modify: `src/components/chat/chat-thread.tsx` (props unchanged)
- Test: create `tests/components/chat-messenger.test.tsx`; existing `chat-thread-*.test.tsx` must pass unchanged

**Interfaces:**
- Consumes: Tasks 2, 6, 7.
- Produces: `ChatThread` with the same `Props`. Behavior details fixed by the spec's Goals; copy fixed here: "Reply", "Edit", "Delete", "Copy", "More", "Message removed", "edited", "Sending…", "Not sent · Retry", "New messages", "Jump to latest", "Delete this message?" (confirm dialog, "Delete" / "Cancel"), reaction aria "React with {label}", chip tooltip names (self as "You").
- Composer: textarea auto-grow to 6 lines, Enter sends, Shift+Enter newline, Escape cancels reply/edit, Up arrow on an empty composer edits your last editable message, emoji grid (~40 common emoji, inserts at caret), existing @mention picker kept.
- Optimistic send: temp id bubble "Sending…"; failure keeps the bubble with "Not sent · Retry"; existing `chat-thread-send-failure` expectations stay true.
- Read marker: only when `document.visibilityState === "visible"` and scrolled within 48 px of the bottom; at most once per 5 s.
- Phone: long-press 450 ms opens the action sheet; desktop hover shows the reaction bar + More; keyboard: bubble focusable, "More" button reachable.

- [ ] **Step 1:** Tests: `groups consecutive messages under one name`, `own bubble uses primary colour, not aral`, `toggles a reaction and shows a count chip`, `reply shows a quote chip and sends replyToId`, `edit within window replaces text and shows edited`, `delete asks first then shows Message removed`, `Enter sends and Shift+Enter adds a newline`, `failed send shows Not sent · Retry and retry resends`, `typing line renders names`, `seen line under newest own message`, `jump to latest shows count when scrolled up`, `does not mark read while scrolled up`.
- [ ] **Step 2:** Run new + existing chat component tests — new FAIL, existing PASS.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npx vitest run tests/components` — PASS. Commit `feat(chat): messenger bubbles, reactions, replies and composer`.

### Task 9: Support Inbox list, tab title, assistant parity

**Files:**
- Modify: `src/lib/chat/queries.ts` (last message preview per channel: `authorId`, author first name, `body` first 120 chars unless deleted, `deletedAt`)
- Modify: `src/components/chat/admin-chat-browser.tsx` (messenger rows, online dot, `previewLine`, relative time, unread badge, "Unread" filter kept)
- Modify: `src/components/admin/admin-support-hub.tsx` (refresh every 10 s while visible, was 30 s)
- Create: `src/components/chat/use-unread-title.ts` — `useUnreadTitle(count: number)` prefixes `document.title` with `(n) ` and restores on unmount
- Modify: `src/components/assistant/assistant-panel.tsx` (assistant bubbles reuse `MessageBubble` styling; three-dot thinking indicator)
- Test: `tests/unit/chat-queries.test.ts`, `tests/components/admin-chat-browser.test.tsx` (extend), `tests/components/use-unread-title.test.tsx`

**Interfaces:**
- Consumes: `previewLine` (Task 2), `MessageBubble`, `TypingIndicator` (Task 8).

- [ ] **Step 1:** Tests: `preview prefixes You: for own last message`, `preview says Message removed`, `row shows online dot when lastOnlineAt within 3 min`, `title shows (2) and restores`, `hub refreshes every 10 s`.
- [ ] **Step 2–4:** FAIL → implement → PASS. Commit `feat(chat): messenger-style support inbox and unread title`.

### Task 10: Release, docs, gates, browser check

**Files:**
- Modify: `src/lib/releases.ts` (2.85.0, `announce: true`, notes per role in user language), `package.json`, `package-lock.json`
- Modify: `docs/deployment.md` (ChatRoom DO, `/chat-ws`, optional `CHAT_SOCKET_SECRET`)

- [ ] **Step 1:** Release entry + versions. `npx vitest run tests/unit/releases*` — PASS.
- [ ] **Step 2:** All gates (Global Constraints). Expected: typecheck 0 errors, lint 0 errors, all tests pass, build exit 0.
- [ ] **Step 3:** Browser on dev :3006 via Test Lab: teacher staff room, School Head admin line, Super Admin Support Inbox; phone and desktop; light and dark. Polling path only (no DO locally). Screenshot proof.
- [ ] **Step 4:** Commit `release: 2.85.0 messenger chat`.
- [ ] **Step 5 (owner approval):** `prisma migrate status` against prod (hostname check), apply `20261124000002_chat_messenger`, then push `git push origin feat/district-summary-scope:main`; watch Workers Builds; on prod, two tabs to see live typing and presence.
