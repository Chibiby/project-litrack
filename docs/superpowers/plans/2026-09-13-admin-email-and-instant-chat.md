# Admin Email and Instant Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send recovery and administrator mail privately from `support@arallitrack.com`, add an Email tab to Admin Support, and render selected chat transcripts immediately.

**Architecture:** Keep Resend behind the existing server-only email adapter, add focused validation/query/action modules for admin mail, and generate Supabase recovery links with the service-role client before sending them through that adapter. Hydrate a selected chat view on the server and pass known channel IDs/initial messages into `ChatThread`, retaining polling only for subsequent updates.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Prisma, Supabase Auth, Resend, Zod, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-09-13-admin-email-and-instant-chat.md`

## Global Constraints

- Outbound identity is exactly `LITRACK Support <support@arallitrack.com>` through Resend.
- Incoming Cloudflare routing to `hugosbrandanleesoliza@gmail.com` remains independent and unchanged.
- Bulk deliveries use one provider request per recipient and never disclose recipient addresses to one another.
- One action accepts at most 50 unique recipients; the per-admin ceiling is 100 recipient deliveries per hour.
- Admin email is plain text with a 1-160 character subject and 1-10,000 character body.
- Synthetic email addresses are never eligible recipients.
- Public password-recovery responses remain uniform and non-enumerating.
- Recovery links, email bodies, subjects, and full address lists are never written to logs or audit metadata.
- No attachments, templates, rich text, scheduling, inbound mailbox, campaign system, or sent-mail archive.

## File map

- `src/lib/email.ts`: provider adapter; return a stable provider message ID while retaining configuration checks.
- `src/lib/validators/admin-email.schema.ts`: normalize and validate admin composer input.
- `src/lib/admin-email/queries.ts`: list eligible teachers and school heads for the recipient picker.
- `src/lib/actions/admin-email.ts`: authorize, rate-limit, deliver separately, and audit aggregate results.
- `src/components/admin/admin-email-composer.tsx`: recipient picker and plain-text composer UI.
- `src/components/admin/admin-support-hub.tsx`: add and route the Email tab.
- `src/app/admin/support/page.tsx`: load recipient options and selected-chat initial data server-side.
- `src/lib/actions/auth.ts`: replace Supabase-managed reset delivery with generated recovery link plus shared sender.
- `src/lib/actions/chat.ts`: expose the existing authorized channel read as a server-query helper without duplicating access rules.
- `src/components/chat/chat-thread.tsx`: accept known channel/initial view and skip the opening waterfall.
- `src/components/chat/admin-chat-browser.tsx`: pass selected channel IDs and hydrated views into the thread.
- `src/lib/audit-actions.ts`: add the aggregate admin-email audit action.
- `.env.example`: document sender and provider variables without secrets.
- Focused tests under `tests/unit` and `tests/components` prove each boundary.

---

### Task 1: Strengthen the shared email adapter and admin input contract

**Files:**
- Modify: `src/lib/email.ts`
- Create: `src/lib/validators/admin-email.schema.ts`
- Create: `tests/unit/email.test.ts`
- Create: `tests/unit/validators/admin-email-schema.test.ts`

**Interfaces:**
- Produces: `sendEmail(input: { to: string[]; subject: string; text: string }): Promise<{ id: string | null }>`
- Produces: `adminEmailSchema` and `AdminEmailInput = { recipients: string[]; subject: string; body: string }`

- [ ] **Step 1: Write failing adapter tests**

Mock `resend` and assert that configured input reaches `emails.send`, its returned `data.id` is exposed, missing configuration throws the existing configuration error, and provider errors are sanitized by the adapter. Use `vi.resetModules()` between environment cases.

- [ ] **Step 2: Run the adapter test and confirm the new return assertion fails**

Run: `npm test -- tests/unit/email.test.ts`

Expected: FAIL because `sendEmail` currently returns `void`.

- [ ] **Step 3: Return the provider ID without widening provider coupling**

Implement this result shape in `src/lib/email.ts`:

```ts
const { data, error } = await new Resend(key).emails.send({
  from,
  to: input.to,
  subject: input.subject,
  text: input.text,
});
if (error) throw new Error(`Resend rejected the email: ${error.name}: ${error.message}`);
return { id: data?.id ?? null };
```

- [ ] **Step 4: Write failing schema tests**

Cover trimming/lowercasing, case-insensitive deduplication, invalid email, synthetic domains, empty subject/body, 160/10,000 character boundaries, and 50/51 unique recipients.

- [ ] **Step 5: Implement the schema and normalization transform**

Create a Zod schema whose transform emits normalized recipients:

```ts
export const adminEmailSchema = z.object({
  recipients: z.array(z.string().trim().email()).min(1).max(50),
  subject: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(10_000),
}).superRefine((value, ctx) => {
  value.recipients.forEach((email, index) => {
    if (isSyntheticEmail(email)) ctx.addIssue({ code: "custom", path: ["recipients", index], message: "Use a real email address" });
  });
}).transform((value) => ({
  ...value,
  recipients: [...new Map(value.recipients.map((email) => [email.toLowerCase(), email.toLowerCase()])).values()],
}));
```

Apply the 50-address limit again after normalization in the server action so transforms cannot weaken the boundary.

- [ ] **Step 6: Run focused tests and commit**

Run: `npm test -- tests/unit/email.test.ts tests/unit/validators/admin-email-schema.test.ts`

Expected: PASS.

Commit: `git commit -m "feat: define outbound email contract"`

---

### Task 2: Add eligible-recipient query and private admin delivery action

**Files:**
- Create: `src/lib/admin-email/queries.ts`
- Create: `src/lib/actions/admin-email.ts`
- Modify: `src/lib/audit-actions.ts`
- Create: `tests/unit/admin-email/queries.test.ts`
- Create: `tests/unit/actions/admin-email.test.ts`

**Interfaces:**
- Produces: `AdminEmailRecipientOption = { id: string; email: string; name: string; role: "Teacher" | "School Head"; schoolName: string }`
- Produces: `listAdminEmailRecipients(): Promise<AdminEmailRecipientOption[]>`
- Produces: `sendAdminEmail(input: unknown): Promise<ActionResult<{ sent: number; failed: { email: string; error: string }[] }>>`

- [ ] **Step 1: Test the recipient query**

Mock Prisma and assert the query requires `role in [TEACHER, SCHOOL_HEAD]`, `isActive: true`, `deletedAt: null`, excludes synthetic emails after reading, orders by school/name, and maps fallback names safely.

- [ ] **Step 2: Implement the focused server-only recipient query**

Call `requireUser()`, reject roles other than `SUPER_ADMIN`, select only IDs, names, role, email, and school name, then filter with `isSyntheticEmail` before mapping display labels.

- [ ] **Step 3: Write failing action tests**

Cover non-admin rejection, invalid input, missing configuration, rate-limit rejection, exactly one `sendEmail({ to: [email] })` call per normalized recipient, continuation after one provider failure, and aggregate result counts.

Assert `writeAudit` receives only:

```ts
{
  action: AUDIT_ACTIONS.ADMIN_EMAIL_SEND,
  resource: "EmailDelivery",
  userId: admin.id,
  metadata: { recipientCount, sentCount, failedCount },
}
```

Also assert serialized audit arguments contain neither subject/body nor recipient strings.

- [ ] **Step 4: Add the audit constant and minimal action**

Add `ADMIN_EMAIL_SEND: "ADMIN_EMAIL_SEND"` to `AUDIT_ACTIONS`. In the action, parse with `adminEmailSchema`, call `requireUser()`, require `SUPER_ADMIN`, and reject when `isEmailConfigured()` is false.

Charge the hourly limit per recipient using stable slots:

```ts
for (let index = 0; index < recipients.length; index += 1) {
  const limit = await checkRateLimit(`admin-email:${admin.id}`, { limit: 100, windowMs: 60 * 60 * 1000 });
  if (!limit.ok) throw tooManyAttempts(limit.retryAfterMs);
}
```

Then send sequentially with `to: [email]`, collecting sanitized `"Delivery failed"` entries and auditing aggregate counts after all attempts.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- tests/unit/admin-email/queries.test.ts tests/unit/actions/admin-email.test.ts`

Expected: PASS.

Commit: `git commit -m "feat: add private admin email delivery"`

---

### Task 3: Build the Admin Support Email workspace

**Files:**
- Create: `src/components/admin/admin-email-composer.tsx`
- Modify: `src/components/admin/admin-support-hub.tsx`
- Modify: `src/app/admin/support/page.tsx`
- Modify: `tests/components/admin-support-hub.test.tsx`
- Create: `tests/components/admin-email-composer.test.tsx`

**Interfaces:**
- Consumes: `AdminEmailRecipientOption[]`, `isEmailConfigured()`, `sendAdminEmail(input)`
- Produces: support-page tab state `"chat" | "tickets" | "email"`

- [ ] **Step 1: Add failing Email-tab integration tests**

Extend the hub test to mock `AdminEmailComposer`, click an `Email` tab, assert `aria-selected="true"`, assert the composer is mounted, and assert routing uses `/admin/support?tab=email`.

- [ ] **Step 2: Add failing composer interaction tests**

Test searching known recipients, selecting multiple chips, adding a normalized manual address, rejecting duplicate/invalid/synthetic addresses, editing subject/body, displaying `N private emails`, disabling send while submitting or unconfigured, and rendering complete/partial failure summaries.

- [ ] **Step 3: Implement the accessible composer**

Use existing Button/Input/Card conventions. Keep selected addresses in a case-insensitive map, render removable chips, provide labelled Subject and Message fields, and call:

```ts
await sendAdminEmail({ recipients: [...selected.keys()], subject, body });
```

Clear subject/body and recipients only after full success; retain content after partial failure so the admin can correct failed destinations without reconstructing the message.

- [ ] **Step 4: Wire the third tab and server data**

Parse `tab=email` in `src/app/admin/support/page.tsx`, load recipient options only for the support page, pass `emailConfigured={isEmailConfigured()}`, and extend the hub's tab union, icon, tabpanel IDs, and URL updates.

- [ ] **Step 5: Run focused tests and commit**

Run: `npm test -- tests/components/admin-support-hub.test.tsx tests/components/admin-email-composer.test.tsx`

Expected: PASS.

Commit: `git commit -m "feat: add admin support email workspace"`

---

### Task 4: Deliver password-recovery mail through support@arallitrack.com

**Files:**
- Modify: `src/lib/actions/auth.ts`
- Create: `tests/unit/actions/password-recovery-email.test.ts`

**Interfaces:**
- Consumes: `createSupabaseAdminClient().auth.admin.generateLink`, `sendEmail`, `reportError`
- Preserves: `requestPasswordReset(formData): Promise<{ ok: true }>` and `/auth/reset` completion flow

- [ ] **Step 1: Write failing recovery-delivery tests**

Mock Prisma, admin Supabase, `sendEmail`, audit, and error reporting. For an eligible account, expect:

```ts
generateLink({
  type: "recovery",
  email: "teacher@example.com",
  options: { redirectTo: `${appUrl()}/auth/reset` },
});
```

Use the returned `data.properties.action_link` in a plain-text message sent to a one-element recipient array. Verify unknown, deleted, inactive, and synthetic accounts call neither generator nor sender. Verify generator and sender failures still return `{ ok: true }` and call `reportError` without placing the link or email body in its arguments.

- [ ] **Step 2: Replace Supabase-managed delivery with generated-link delivery**

Inside the existing eligible-account branch, use the admin client and validate `properties.action_link` before sending:

```ts
const { data, error } = await admin.auth.admin.generateLink({
  type: "recovery",
  email,
  options: { redirectTo: `${appUrl()}/auth/reset` },
});
if (error || !data.properties?.action_link) throw new Error("Recovery link generation failed");
await sendEmail({
  to: [email],
  subject: "Reset your LITRACK password",
  text: `A password reset was requested for your LITRACK account.\n\nReset your password: ${data.properties.action_link}\n\nIf you did not request this, you can ignore this email.`,
});
```

Keep the catch/report/audit behavior outside all public response content. Report only a fixed failure reason plus user/school IDs.

- [ ] **Step 3: Run focused auth tests and commit**

Run: `npm test -- tests/unit/actions/password-recovery-email.test.ts`

Run: `npm test -- tests/unit/actions/auth*.test.ts tests/components/forgot-password-form.test.tsx`

Expected: PASS (Vitest may report no match for a legacy glob only if that named file does not exist; run the concrete discovered auth test files in that case).

Commit: `git commit -m "feat: send recovery mail from support address"`

---

### Task 5: Remove the existing-channel opening waterfall

**Files:**
- Modify: `src/lib/actions/chat.ts`
- Modify: `src/app/admin/support/page.tsx`
- Modify: `src/components/chat/admin-chat-browser.tsx`
- Modify: `src/components/chat/chat-thread.tsx`
- Modify: `tests/components/admin-chat-browser.test.tsx`
- Modify: `tests/components/chat-thread-empty.test.tsx`
- Create: `tests/components/chat-thread-initial-view.test.tsx`

**Interfaces:**
- Produces: `readChannelForUser(channelId: string, user: SessionUser): Promise<ChatChannelView>` as the shared authorized query core
- Adds ChatThread props: `channelId?: string` and `initialChannel?: ChatChannelView | null`
- Adds AdminChatBrowser prop: `initialChannel?: ChatChannelView | null`

- [ ] **Step 1: Write failing hydration and switching tests**

Render `ChatThread` with a known ID and initial messages. Assert those messages appear synchronously, `Opening the conversation…` is absent, and `openChannel` is not called. Then render the admin browser, select a second known conversation, and assert its channel ID is passed directly without an `openChannel` call.

- [ ] **Step 2: Extract the authorized read core**

Move the query/map body currently inside `readChannel` into a server-only helper that takes the already-authenticated user. Keep the exported action as:

```ts
export async function readChannel(input: unknown) {
  const user = await requireUser();
  const parsed = readChannelSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  try { return { ok: true, data: await readChannelForUser(parsed.data.channelId, user) }; }
  catch { return { ok: false, error: "Not found" }; }
}
```

Use that same helper from the server page after `requireUser()` when the URL's selected channel exists in `listAdminChatSchools`.

- [ ] **Step 3: Initialize ChatThread synchronously**

Initialize state and refs from props:

```ts
const [channel, setChannel] = useState<ChatChannelView | null>(initialChannel ?? null);
const channelIdRef = useRef<string | null>(channelId ?? initialChannel?.id ?? null);
const latestRef = useRef<string | null | undefined>(initialChannel ? initialChannel.messages.at(-1)?.id ?? null : undefined);
```

When `channelId` exists, skip `openChannel`, render initial data immediately, refresh that ID in the background, and load mention targets independently. Preserve the old create-on-first-use path when no ID is supplied.

- [ ] **Step 4: Pass known channel IDs through the admin browser**

Every admin conversation already has an ID. Pass `channelId={selected channel ID}` and the matching `initialChannel` only when IDs agree. On selection, render the transcript panel immediately with a compact skeleton only if that newly selected ID lacks cached data; never show the old opening sentence for an existing admin channel.

- [ ] **Step 5: Run focused chat tests and commit**

Run: `npm test -- tests/components/admin-chat-browser.test.tsx tests/components/chat-thread-empty.test.tsx tests/components/chat-thread-initial-view.test.tsx tests/components/assistant-chat-tabs.test.tsx`

Expected: PASS.

Commit: `git commit -m "perf: open admin conversations immediately"`

---

### Task 6: Configuration, regression gates, and operational verification

**Files:**
- Modify: `.env.example`
- Modify: `README.md` only if it already contains deployment configuration instructions

**Interfaces:**
- Documents: `RESEND_API_KEY` and `RESEND_FROM_EMAIL=LITRACK Support <support@arallitrack.com>`

- [ ] **Step 1: Document configuration without committing credentials**

Add the two variable names and explain that Resend domain verification records coexist with Cloudflare Email Routing records. Include no real API key.

- [ ] **Step 2: Run the complete automated verification suite**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Expected: every command exits 0. If `next lint` is unsupported by the pinned Next version, run the repository's configured ESLint command directly and record the exact substitution in the implementation report.

- [ ] **Step 3: Verify the user flows in a browser**

At desktop and mobile widths, verify Chat, Support Tickets, and Email tabs; known and manual recipient chips; private-recipient count; disabled configuration state; sending state; full and partial result states; direct URL hydration of a selected chat; and rapid switching between conversations without `Opening the conversation…`.

- [ ] **Step 4: Complete external provider setup**

In Resend, verify `arallitrack.com`. Add only Resend's supplied DNS records to Cloudflare, preserving the active Email Routing records. Add the API key and exact sender string to Vercel production/preview environments and redeploy.

- [ ] **Step 5: Perform production smoke tests**

Send one admin email to `hugosbrandanleesoliza@gmail.com`, reply to it and confirm Cloudflare forwarding, then request a reset for a controlled test account and complete the password reset. Never use a real teacher's account for the smoke test.

- [ ] **Step 6: Commit documentation and report evidence**

Commit: `git commit -m "docs: document support email operations"`

Report focused/full test results, typecheck/lint/build exit codes, Resend verification status, Cloudflare routing preservation, Vercel variable names, and smoke-test outcomes without revealing secrets or recovery links.
