# Admin Email and Instant Chat Design

**Date:** 2026-09-13
**Status:** approved for implementation

## Goal

Send LITRACK password-recovery and administrator-authored mail from
`LITRACK Support <support@arallitrack.com>`, add an Email workspace to the
Super Admin support page, and make existing conversations render immediately
when selected.

Incoming mail to `support@arallitrack.com` remains a Cloudflare Email Routing
alias that forwards to `hugosbrandanleesoliza@gmail.com`. Outgoing mail uses
Resend after `arallitrack.com` is verified there; Cloudflare routing is not used
as an outbound mailbox.

## Product boundaries

- `/admin/support` remains Super-Admin-only and gains a third `Email` tab beside
  `Chat` and `Support Tickets`.
- Administrators may choose active teachers and school heads from LITRACK or
  enter valid external email addresses.
- A message may have multiple recipients, but each recipient receives a
  separate private delivery. Recipient addresses are never exposed to one
  another through `To`, `Cc`, or message content.
- The first version supports plain-text subject and body only. Attachments,
  templates, scheduling, rich text, inbound mailbox reading, and campaigns are
  outside scope.
- Cloudflare continues forwarding replies to the verified Gmail destination.
- Resend is the sole outbound provider and the existing `src/lib/email.ts`
  module remains the provider boundary.

## Email configuration

Production requires:

```text
RESEND_API_KEY=<secret API key>
RESEND_FROM_EMAIL=LITRACK Support <support@arallitrack.com>
```

Resend's domain-verification DNS records must be added to the existing
Cloudflare zone without removing the Email Routing MX/SPF/DKIM records. Secrets
must be configured in deployment settings and must never be committed.

The admin Email tab displays a clear unavailable state when outbound email is
not configured. It must not silently accept a message that cannot be sent.

## Administrator composer

The Email tab contains:

1. A searchable recipient picker populated with active, non-deleted teachers
   and school heads. Each result shows the person's name, role, school, and
   email.
2. A manual-address input that validates and normalizes addresses before adding
   them as recipient chips.
3. Subject and plain-text message fields.
4. A delivery summary showing the number of private emails that will be sent.
5. A send action with a disabled/submitting state and a final per-recipient
   outcome summary.

Duplicate addresses are removed case-insensitively. Synthetic/internal account
addresses are excluded from the picker and rejected when entered manually.
The server revalidates every submitted field and never trusts client-provided
user names, roles, or school labels.

The first version caps one action at 50 unique recipients and applies a
per-admin rate limit of 100 recipient deliveries per hour. These limits reduce
accidental blasts and provider abuse while supporting normal division support
work.

## Sending semantics

The server requires a current Super Admin session and validates:

- 1-50 unique real email addresses;
- a trimmed subject of 1-160 characters;
- a trimmed body of 1-10,000 characters; and
- configured Resend credentials and sender identity.

The action invokes the provider once per recipient with a one-element `to`
array. Deliveries are attempted independently so one rejected address does not
prevent the remaining recipients from being attempted. The result reports
counts and sanitized recipient-level failures without exposing provider secrets
or stack traces.

One audit event records the administrator, recipient count, success count, and
failure count. The subject, body, and full external address list are not stored
in audit metadata. This feature does not introduce a sent-mail archive.

## Password recovery

The public forgot-password action keeps its existing uniform success response,
rate limit, active-account check, and synthetic-address exclusion.

For an eligible account, the server uses the Supabase service-role client to
generate a recovery link whose redirect target is `${NEXT_PUBLIC_APP_URL}/auth/reset`.
It sends a concise plain-text recovery message through the shared Resend module
from `support@arallitrack.com`. The link is never logged or written to the
database.

Generation or delivery failure is reported through the existing internal error
reporting path while the public response remains successful, preventing account
enumeration. The existing password-reset completion route and recovery-session
handling remain unchanged.

## Instant conversation opening

The admin conversation list already contains IDs for existing channels. The
support page will read the selected channel's recent messages on the server and
pass a complete `ChatChannelView` into the client as initial state. Selecting a
different existing conversation fetches its view directly by channel ID; it
does not call `openChannel` first.

`ChatThread` accepts an optional known channel ID and initial channel view. When
initial data exists, it renders synchronously and starts polling in the
background. The `Opening the conversation…` state remains only for flows that
genuinely need to create a channel on first use, such as a staff member opening
a room that does not yet exist.

Authorization continues through the existing channel-access gate. The client
cannot use a supplied channel ID to bypass school or role checks. Mention
targets may load after the transcript because they do not block reading.

## Failure behavior

- Missing email configuration disables the admin send action and produces an
  actionable setup message.
- Partial bulk failure reports how many private deliveries succeeded and which
  submitted addresses need attention, without resending successes automatically.
- Forgot-password failure remains non-enumerating and is recorded internally.
- A selected channel that is missing or unauthorized shows the existing safe
  not-found error.
- Background polling failure leaves the last rendered transcript visible.

## Testing

Tests must cover:

- email validation, normalization, deduplication, synthetic-address rejection,
  and the 50-recipient boundary;
- Super-Admin authorization and hourly recipient rate limiting;
- one provider call per recipient and partial-success reporting;
- audit metadata containing counts but no subject, body, reset link, or address list;
- password recovery using an admin-generated recovery link and shared sender;
- the same public response for unknown accounts and provider failures;
- reset links and email bodies never entering logs or audit metadata;
- the Email tab, known-recipient search, manual recipients, disabled setup state,
  submitting state, and success/partial-failure summaries;
- direct navigation to a selected channel rendering initial messages without an
  opening placeholder;
- switching between known conversations without calling `openChannel`;
- existing empty-channel, polling, message-send, ticket, and responsive chat
  behavior remaining intact.

Proportional verification is the focused unit/component suite, full Vitest run,
TypeScript check, lint, production build, and desktop/mobile browser checks of
the Email tab and conversation switching.

## Release and operations

Deployment order is:

1. Verify `arallitrack.com` in Resend and add the supplied DNS records in
   Cloudflare while preserving routing records.
2. Configure `RESEND_API_KEY` and
   `RESEND_FROM_EMAIL=LITRACK Support <support@arallitrack.com>` in Vercel.
3. Deploy the application changes.
4. Send one test email to the forwarding Gmail account and complete one test
   password recovery before announcing availability.

If outbound mail must be disabled, remove or rotate `RESEND_API_KEY`; inbound
Cloudflare forwarding continues independently.
