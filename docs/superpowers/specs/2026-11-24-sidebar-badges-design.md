# Sidebar badges — design

Date: 2026-11-24. Status: awaiting owner approval.

## Intent

Admins miss school concerns because nothing in the side menu says work is
waiting. The owner asked for count badges on the side menu, starting with the
Support Inbox, and for every other menu item where a count means "something
here needs you". For the Super Admin team the inbox is shared: once any admin
has read or replied to a conversation, it is handled for every admin — the
badge and the bell notification clear for all of them.

## Goals

- A number on each menu item listed below, showing work waiting there.
- Super Admin chat read state is team-wide: read by one admin = read by all.
  This covers the sidebar badge, the conversation list's unread dots, the tab
  title count and the bell's chat notifications.
- The Support count feels live (a new concern appears within ~30 s without
  navigating); every other badge refreshes on navigation.

## Non-goals

- No badge where the page has nothing to act on (Admin and District
  Transfers are view-only).
- No second badge for revision-access requests: they are support tickets and
  already count under Support.
- No change to how School Heads and teachers see their own chat unread state
  (the assistant panel keeps its per-person dots).
- No database migration.

## Anti-goals

- A badge that disagrees with the page it points to.
- A count that leaks another school's or district's work.
- Steady polling load from every signed-in teacher.

## Approaches considered

- **A. Server only** — counts computed in each role layout, cached briefly,
  busted by the existing revalidate helpers. Cheapest; chat shows only on
  navigation.
- **B. Poll everything** — a GET route polled every 30 s for every role. Live
  everywhere; constant DB load from every signed-in user.
- **C. Hybrid (chosen by owner)** — A for every badge, plus a 30 s poll of the
  Support count only, for Super Admins and district admins.

## The badges

| Role | Menu item | Count |
|---|---|---|
| Super Admin | Support Inbox | conversations waiting + tickets `OPEN`/`IN_PROGRESS` |
| District admin | Support | tickets `OPEN`/`IN_PROGRESS` in their scope (same query as `getDistrictNotifications`) |
| School Head | Teachers | pending approvals (exists, unchanged) |
| School Head | Transfer | incoming `SchoolTransferRequest` `PENDING` and not past `expiresAt` + `SectionTransferRequest` `PENDING` for the school |
| School Head | Monitoring: non-compliance / ARAL / discrepancies | the three counts `buildMonitoringAttention` already shows, from the same cached `MonitoringCounts` |
| Teacher | ARAL Profiling | learners in the tutor's scope with no completed ARAL Profile (same rule as the dashboard Pending Profiles card) |

Zero hides the badge (existing `NavItem.badge` behaviour). Counts above 99 show
"99+". A Super Admin impersonating a school sees that school's badges.

## Team-wide chat read rule

A Super Admin conversation is **waiting** when it has a message newer than the
latest `ChatRead.lastReadAt` among all Super Admin users for that channel.
Sending a message already marks the sender's read, so a reply counts as
handled. Opening a conversation additionally marks every Super Admin's unread
`CHAT_MENTION` / `CHAT_DIRECT_MESSAGE` notifications for that channel as read
(a bounded update: `channelId` + type + `readAt: null` + recipient role).

**Builder's call, flagged for the owner:** only `ADMIN_DIRECT` ("Ask admin")
threads count toward "conversations waiting". School staff-room chatter is
teachers talking to each other, not a request to admins, so it keeps its
unread dot in the list but does not raise the sidebar number.

## Constraints

- Tenancy: every School Head / teacher count filters by `schoolId`; district
  counts go through `schoolWhereForScope`.
- Badge counts are wrapped in `cachedQuery` (≤30 s TTL) with tags busted by
  the existing helpers in `src/lib/cache/revalidate.ts`; a failed count hides
  the badge, never the page (`Promise.allSettled`, as the School Head layout
  already does).
- The poll is a GET route under `/api` (middleware skips `/api/`), like the
  chat poll routes, so it never queues behind server actions or re-renders the
  page.
- Release entry + middle-number version bump on push (feature).

## Left to the builder

File layout, the exact `NavOptions` shape (a `badges` map keyed by nav id is
expected), poll interval within 20–30 s, and test structure.
