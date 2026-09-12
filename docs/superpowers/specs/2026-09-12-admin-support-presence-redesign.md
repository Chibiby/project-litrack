# Admin Support Presence Redesign

**Date:** 2026-09-12
**Status:** approved for implementation

## Goal

Reshape `/admin/support` to closely follow the supplied compact two-pane support
layout while preserving the product's existing chat and ticket rules, and show
truthful teacher presence as either `Online` or a relative `Last online` value.

The supplied screenshot is a visual reference only. Its sample people, messages,
dates, counts, and `New Ticket` action are not product requirements and must not
replace or invent application data.

## Product boundaries

- The page remains Super-Admin-only and division-wide.
- Existing school chat, private admin conversations, message search, unread
  state, ticket resolution, unlock grants, and ticket decline/revoke behavior
  remain intact.
- Super Admins continue to answer tickets rather than file tickets to themselves.
  Therefore the reference's `New Ticket` button is intentionally omitted.
- No new role, ticket workflow, chat channel kind, realtime provider, or external
  service is introduced.
- Presence is recorded for real teacher sessions only. Super-Admin impersonation
  must never make the target teacher appear online.

## Layout

The page uses the reference's hierarchy and density:

1. Existing page title and explanatory subtitle.
2. A compact bordered tab bar with `Chat` and `Support Tickets`.
3. Chat renders as one bordered, rounded workspace split into:
   - a fixed-width conversation rail containing its title, compose affordance,
     search field, filter pills, and scrollable conversations;
   - a flexible conversation panel containing the participant header, optional
     message search, transcript, and bottom composer.
4. On narrow screens the two panes remain an accessible drill-in flow: the
   conversation list is shown first and the selected thread has a Back control.
5. The existing support-tip panel is removed from the primary visual flow so the
   layout begins with the compact tab bar like the reference.
6. Tickets render under the same tab container but retain their existing queue,
   answer dialog, grant, decline, and revoke controls.

The design reuses current color tokens, typography, buttons, badges, and inputs.
It does not hard-code the screenshot's pixel colors or sample content.

## Conversation data

`listAdminChatSchools(adminId)` remains the server-side source for the admin
conversation list. Direct-thread rows gain the minimum additional data needed by
the client:

```ts
type DirectThread = {
  id: string;
  memberId: string;
  memberName: string;
  memberRole: "Teacher" | "School Head";
  lastMessageAt: Date | null;
  lastOnlineAt: Date | null;
  unread: boolean;
};
```

Conversation previews continue to use only data the system has. If the query can
read the newest non-deleted message cheaply within the existing channel query, it
may expose its body as the preview; otherwise the current neutral preview text is
retained. No fabricated message or sender is shown.

School rooms do not receive a single-person presence indicator because they may
contain many staff members. Their selected header says `School conversation`.
Direct conversations show the member's presence.

## Presence model

Add one nullable column to `User`:

```prisma
lastOnlineAt DateTime?
```

No backfill is required. `null` means the application has never recorded an
eligible active session for that account. The migration is additive and does not
rewrite existing rows.

### Heartbeat semantics

- Only an authenticated, active `TEACHER` may update presence.
- The server derives the user id from the authenticated session; callers cannot
  name another user.
- A heartbeat is accepted only from a normal teacher session. When the session
  carries a Super-Admin impersonation ticket for that teacher, it returns without
  writing.
- The client mounts once in the teacher app shell.
- It records on initial visible activity, on returning to a visible tab, and
  after genuine keyboard, pointer, touch, focus, or navigation activity.
- Writes are throttled to at most one per minute per mounted client. The server
  also avoids rewriting a timestamp that is already less than one minute old,
  preventing a modified client from creating an unbounded write loop.
- No heartbeat is sent while `document.visibilityState !== "visible"`.
- A failed heartbeat is silent and retryable on later activity; presence is
  informational and must never block normal teacher work.

### Status calculation

At render time:

- `Online` when `lastOnlineAt >= now - 3 minutes`.
- Otherwise `Last online <relative time>` such as `50m ago`, `3h ago`, or
  `2d ago`.
- For older timestamps, use a compact localized date rather than an indefinitely
  growing number of days.
- For `null`, show `Last online unavailable`.

The green dot is used only for `Online`; historical/unavailable states use a
muted dot and muted text. Relative labels refresh on a lightweight client timer
so an open support page naturally moves from `Online` to `Last online 3m ago`
without a full navigation.

This is active-app presence, not proof that the user is looking at a particular
conversation. The UI must not use stronger language such as `currently viewing`.

## Security and privacy

- Heartbeat input contains no user id, school id, or timestamp. The server owns
  all three values.
- The presence action uses the same authenticated session and impersonation
  binding used by the teacher layout.
- Only the Super Admin support query reads another person's `lastOnlineAt`.
- Presence is not written to `AuditLog`: once-per-minute activity logs would add
  high-volume behavioral tracking with no security or operational value.
- No IP address, device detail, route, or activity event is persisted.
- The timestamp is not exposed to school-room participants or other teachers by
  this change.

## Failure behavior

- A missing timestamp renders `Last online unavailable`.
- Database or network failure in the teacher heartbeat does not surface an error
  toast and does not interrupt the page.
- If a selected direct thread has no member, it keeps the existing safe fallback
  and never claims that person is online.
- Chat polling and presence refresh are independent. A presence failure cannot
  stop messages, and a message-poll failure cannot forge presence.

## Testing

Tests must cover:

- the migration/schema contains nullable `User.lastOnlineAt`;
- a teacher heartbeat writes only the signed-in teacher and uses server time;
- a non-teacher cannot create teacher presence;
- an impersonating Super Admin does not update the target teacher;
- server-side throttling skips a timestamp younger than one minute;
- `listAdminChatSchools` returns direct-member presence without applying it to
  school rooms;
- exactly three-minute freshness semantics at the boundary;
- relative labels for online, minutes, hours, old dates, and missing timestamps;
- selected direct headers display the real status;
- selected school headers display `School conversation`;
- filtering, private-thread member selection, ticket switching, responsive Back,
  message search, and existing responder-only ticket behavior remain intact.

Proportional verification is the focused unit/component suite, full Vitest run,
TypeScript check, lint, production build, and a visual check at desktop and mobile
widths against the supplied hierarchy.

## Release

This user-visible feature receives a minor semantic version increment from
`1.9.0` to `1.10.0`, with release notes describing the support workspace redesign
and teacher presence labels. The final implementation is committed and pushed to
`main` only after all verification gates pass, preserving unrelated local files.
