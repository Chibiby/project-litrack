# Messenger-style chat — design

Date: 2026-11-24
Status: approved in conversation (owner: "yes, write the design doc and build it")

## Intent

Every chat in LITRACK should feel like a real messenger: live, expressive and
quick to answer in. Today the chat is a plain transcript that polls every
6–30 s, with no reactions, replies, edits, typing or per-message "seen". The
owner wants one shared, polished chat design built from the shadcn Message,
Bubble and Message Scroller patterns, restyled to the LITRACK design system,
with live presence and typing, and "as many functions as fit its use".

## Surfaces (all share one chat component)

1. **Staff room** (`SCHOOL` channel) — assistant widget, "School chat" tab.
2. **Admin team line** (`ADMIN_DIRECT` channel) — assistant widget, "Admin team" tab.
3. **Support Inbox chat** — `/admin/monitoring/support` (`AdminChatBrowser`), the
   Super Admin's conversation list plus the open thread.
4. **Assistant (Gemini)** — same bubble styling and a thinking indicator. It
   stays a request/answer flow (no reactions, no realtime).

Access rules do not change: `assertChannelAccess` in `src/lib/actions/chat.ts`
stays the single gate. District admins get no new chat access.

## Goals

- Bubbles grouped by sender (consecutive messages within 5 minutes), own
  messages right in primary blue, others left with avatar; day dividers;
  time on hover / tap.
- Reactions: six quick emoji (👍 ❤️ 😂 😮 😢 🙏) from a hover bar (desktop) or
  long-press (touch). One reaction per emoji per person, toggled. Chips under
  the bubble with counts; a chip's tooltip lists who reacted; your own
  reaction is highlighted.
- Reply: quote a message; the quote shows author + first line and scrolls to
  the original when clicked (if loaded).
- Edit own message within 15 minutes ("edited" tag). Delete own message any
  time (soft delete; shows "Message removed"). Super Admin may delete any
  message in a channel they can see (moderation), audited.
- Copy message text.
- Typing indicator: "Ana is typing…", "Ana and Ben are typing…", "3 people are
  typing…", with animated dots.
- Seen: under your newest message, "Seen by Ana, Ben +2" in the staff room;
  "Seen 2:14 PM" on the admin line. Built from `ChatRead.lastReadAt`.
- Presence: "Active now" (connected to this room, or `lastOnlineAt` within
  3 min) or "Active 5m ago"; green dot on avatars and in the thread header.
- "New messages" divider at the first unread on open; jump-to-latest button
  with the count of messages that arrived while scrolled up.
- Search within the thread (keeps the existing `messageQuery` highlight).
- Composer: auto-growing textarea (max ~6 lines), Enter sends, Shift+Enter
  newline, emoji picker button (a built-in grid, no new dependency), the
  existing @mention picker, reply preview chip with cancel.
- Optimistic send: the bubble appears at once as "Sending…"; on failure it
  shows "Not sent · Retry".
- Support Inbox list: messenger-style rows — avatar with online dot, name,
  school, last message preview (author-prefixed, "You: …"), relative time,
  unread badge; search and an "Unread" filter.
- Unread count in the browser tab title while a chat surface is open.

## Non-goals

Photos/files, voice notes, calls, creating new group chats, forwarding,
pinning, link previews, message history editing log, push notifications.

## Anti-goals

- A cross-tenant leak through the live channel. The socket must be at least
  as strict as the server actions.
- Typing/presence traffic reaching Postgres (Neon egress took prod down in
  October 2026).
- A chat that stops working when the live connection is unavailable.

## Approaches considered

1. **Faster polling (~2 s)** — no new infrastructure, but typing arrives 2–3 s
   late and every open chat multiplies database reads.
2. **Cloudflare Durable Objects + WebSockets** *(chosen by the owner)* — instant
   messages, typing and presence; typing/presence never touch the database;
   one new Durable Object class on the existing Worker (Free plan includes
   SQLite-backed Durable Objects within daily limits).
3. A third-party realtime service (Pusher/Ably/Supabase Realtime) — ruled out:
   a new vendor, a second authorization surface, and data leaving Cloudflare.

## Architecture

### Source of truth

Postgres stays the only store of messages, reactions, edits and reads. Every
write still goes through a wrapped server action (`action()` in
`src/lib/errors/action.ts`) that runs `assertChannelAccess`. After a write
commits, the action **publishes** an event to the channel's room. Publishing
is best-effort: a failure is logged, never thrown; clients still catch up by
polling.

### The room (Durable Object)

- Class `ChatRoom`, one instance per channel (`idFromName(channelId)`),
  exported from `worker.js`, bound as `CHAT_ROOM` in `wrangler.jsonc` with a
  `new_sqlite_classes` migration.
- Uses the WebSocket Hibernation API (`ctx.acceptWebSocket`,
  `webSocketMessage`, `webSocketClose`) so idle rooms cost nothing.
  Each socket's attachment holds `{ userId, displayName, initials }`.
- Client → room messages: `typing` (start/stop) and `ping`. Nothing a client
  sends is rebroadcast except a typing state, re-labelled with the identity
  from the socket attachment (a client can never speak as someone else).
- Room → clients events: `message.created`, `message.updated` (edit/delete),
  `reaction.changed`, `read.changed`, `typing`, `presence` (the set of
  connected user ids, sent on join/leave).
- Server → room publish: `POST` to the DO stub with a JSON event, called from
  server actions through `getCloudflareContext().env.CHAT_ROOM`. Events carry
  ids and the already-shaped view the client renders; the client re-checks
  nothing it can't (it only renders what its own server read would).

### Joining a room (authorization)

1. Client calls server action `openChatSocket({ channelId })`. It runs
   `requireUser` + `assertChannelAccess`, then returns a ticket: base64url of
   `{ c: channelId, u: userId, n: displayName, i: initials, exp: now+60s }`
   plus an HMAC-SHA256 signature with `CHAT_SOCKET_SECRET` (falls back to
   `BETTER_AUTH_SECRET` when unset).
2. Client opens `wss://<origin>/chat-ws?ticket=…`.
3. `worker.js` intercepts `/chat-ws` before OpenNext, verifies signature and
   expiry with Web Crypto, rejects with 401 otherwise, and forwards the
   upgrade to `CHAT_ROOM.get(idFromName(ticket.c))` with the identity in
   headers the room trusts only from the Worker (the room has no public
   route).
4. Tickets are single-channel and expire in 60 s; reconnects fetch a new one.

### Fallback

The client hook `useChatLive(channelId)` tries the socket; when there is no
`CHAT_ROOM` binding (local `next dev`), the ticket action returns
`{ live: false }`, or the socket fails 3 times, it keeps today's adaptive
polling (`chatPollDelayMs`). While the socket is open, polling drops to a 60 s
safety net. Typing and live presence simply don't show without the socket.

### Data model (additive migration)

- `ChatReaction { id, messageId → ChatMessage (cascade), userId → User
  (cascade), emoji String, createdAt; @@unique([messageId, userId, emoji]);
  @@index([messageId]) }`. `emoji` is validated against the six allowed.
- `ChatMessage.replyToId String?` → self relation (`onDelete: SetNull`),
  `ChatMessage.editedAt DateTime?`.
- `ChatRead` unchanged; "seen" = other members' `lastReadAt` ≥ message time.
- New tables join `SNAPSHOT_MODELS`/`KEYSET_KEYS` (backups), RLS enabled in
  the migration and `prisma/rls-policies.sql`, `archive/purge.ts` updated if
  it deletes chat rows.

### Server actions (all wrapped, all through `assertChannelAccess`)

- `readChannel` (extended view: reactions, replyTo summary, editedAt,
  deleted flag, read markers of other members, member presence).
- `sendChatMessage` (+ optional `replyToId`, must be in the same channel).
- `editChatMessage` (author only, within 15 min, not deleted).
- `deleteChatMessage` (author, or Super Admin; audited for admin).
- `toggleChatReaction` (one of six emoji).
- `markChannelRead` (publishes `read.changed`).
- `openChatSocket` (ticket).
- Rate limits: reactions and edits share the existing chat limit bucket.

## UI components (src/components/chat/)

- `chat-thread.tsx` — orchestrates; keeps its props so its two callers do
  not change shape.
- `message-bubble.tsx`, `message-group.tsx`, `reaction-bar.tsx`,
  `reaction-chips.tsx`, `typing-indicator.tsx`, `seen-line.tsx`,
  `chat-composer.tsx`, `emoji-picker.tsx`, `message-scroller.tsx`
  (scroll-anchoring, "New messages" divider, jump-to-latest),
  `use-chat-live.ts` (socket + fallback).
- Styling: existing tokens only; own bubble `bg-primary text-primary-foreground`,
  others `bg-muted`; never violet (ARAL accent) except where the ARAL theme
  already uses it; dark mode via tokens; 44 px touch targets on phones.
- Accessibility: the log is `role="log" aria-live="polite"`; reactions are
  buttons with `aria-pressed` and labels ("React with thumbs up"); the
  typing line is `aria-live="polite"`; long-press has a keyboard path (focus
  the bubble, press the "More" button).

## Builder's calls (decided here, not by the owner)

- Grouping window 5 minutes; edit window 15 minutes; ticket TTL 60 s.
- Six fixed emoji; no custom emoji or free picker for reactions (the composer
  emoji grid is for typing only).
- Admin moderation delete is allowed for Super Admin only.
- Read markers are shown for at most the newest own message.
- The Gemini assistant gets visual parity only.
- Support Inbox list is not live: it refreshes every 10 s while visible (was
  30 s); only the open thread uses the room.
- Room events are viewer-neutral (author id, reactor ids); each client derives
  `isSelf`, its own highlighted reaction and "You:" itself.
- Access loss: the room closes every socket after 10 minutes; the client
  reconnects with a fresh ticket, which re-runs `assertChannelAccess`. So a
  removed member loses the live feed within 10 minutes, and server actions
  refuse them at once.
- Edits keep existing mention rows and resolve only newly added @mentions,
  which notify like a new message. Reactions, replies-to-you and edits create
  no notification and do not count as unread.
- A read is recorded when the tab is visible and the thread is scrolled to the
  newest message, at most once every 5 s per channel.
- When the Durable Object is missing or over its Free-plan quota, the chat
  falls back to polling; `openChatSocket` returns `{ live: false }` when the
  binding is absent, so the first deploy is safe before the binding exists.
- `ChatRoom` is exported from `worker.js` next to OpenNext's exports and
  `/chat-ws` is intercepted before OpenNext; Workers Builds runs
  `wrangler deploy`, which applies the `new_sqlite_classes` migration.

## Testing

- Unit: ticket sign/verify (expiry, tamper, wrong channel), room event
  relabelling, grouping/seen/typing label helpers, reaction toggle rules,
  edit window, reply-in-same-channel check, access refusal for every new
  action (cross-school, other member's direct line).
- Component: bubble actions, reactions chips, composer keys, optimistic
  retry, typing line, fallback when the ticket says `live: false`.
- Browser: staff room and admin line through Test Lab roles, Support Inbox as
  Super Admin, desktop and phone, light and dark; two tabs to see live
  typing — on the deployed Worker only (local dev has no Durable Object).

## Rollout

1. Additive migration applied to production first (with approval).
2. `CHAT_SOCKET_SECRET` secret on the Worker (optional; falls back).
3. Release entry (feature → minor version).
