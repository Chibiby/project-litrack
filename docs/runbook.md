# Operations runbook — PROJECT LITRACK

Operational procedures for admins. Does not replace training or legal advice.

## Read back a School Head's own password

**When:** SH forgot the password they chose, and you would rather tell them what
it is than take it away from them.

1. Super Admin → `/admin/school-accounts` → the eye icon in the Password column.
2. If the cell says **"Set before LITRACK could record it"**, there is nothing to
   read — go to the Reset procedure below. Only passwords set from 2026-09-11
   onwards were sealed, and a `PASSWORD_VAULT_KEY` rotation makes anything
   sealed under the old key unreadable in the same way.
3. Every reveal writes `SCHOOL_HEAD_PASSWORD_VIEWED` to `/admin/audit` against
   your account. Do it because someone asked, not to browse.

Reveal changes nothing for the head — they keep signing in with what they have.
Prefer it to Reset for exactly that reason. Teacher passwords are never stored
and cannot be read back by anyone; teachers use `/forgot-password` (real email)
or a re-invite. The privacy consequences of storing these at all are in
`docs/privacy.md`.

## Reset a School Head's password to the School ID

**When:** SH forgot the password they chose and it is not on record (see above) /
locked out / synthetic email cannot receive reset mail.

1. Super Admin → `/admin/schools` → key icon on the school's row (or `/admin/school-accounts`
   → Reset to School ID — the two do the same thing).
2. Tell the School Head to sign in with their **School ID**. It works immediately; there is no
   forced password change, and they can set a private password later from Settings → Security.
3. Confirm audit: `SCHOOL_HEAD_PASSWORD_RESET_DEFAULT`.

The key icon used to issue a random one-time credential instead. Heads kept typing their School
ID into accounts that no longer accepted it (Salimama IS, 2026-09-10), so it was changed to match.
Rows written before then say `SCHOOL_HEAD_CREDENTIAL_REGENERATED`.

**Extension schools** sign in with the mother school's plain ID — `130554`, not `130554-2` — and
every reset path now sets that. Before this was fixed, Reset set the suffixed code, so an extension
head who was reset before then may still be on `130554-2`. If the plain ID is refused, press Reset
once more; it will then be the plain ID.

## Add an extension school

An extension shares its mother school's DepEd School ID, but the stored School ID must be unique
(it builds the School Head's login email). So it takes the next free `-N` suffix, the same rule the
roster import uses.

1. Find the group on `/admin/schools` by searching the mother school's ID, e.g. `130554` —
   Naidas T. Opong ES is `130554`, its Banlas Extension `130554-2`.
2. Super Admin → `/admin/schools` → Create school. Name it after the mother school with the
   extension in brackets, e.g. `Naidas T. Opong ES (Litos Extension)`; School ID is the next
   free suffix, e.g. `130554-3`.
3. The success screen shows the initial password. It is the **plain** ID (`130554`) — every
   school in the group starts on it, and the School Head types it after picking their own
   school. `mustChangePassword` is forced.

If the form says the School ID already exists, that suffix is taken — use the next one.

## Teacher invite: resend / revoke

**Resend:** School Head → Teachers → resend invite. Regenerates credential/token; previous link invalidated as designed. Email sent when invite has a real address; otherwise show on-screen credential.

**Revoke:** School Head → revoke invite. Sets `revokedAt`; accept path rejects. Audit: `TEACHER_INVITE_RESEND` / `TEACHER_INVITE_REVOKE`.

If the teacher already activated, use password reset (real email) or Super Admin/school-head account disable patterns (`isActive` / soft delete) rather than invite revoke.

## Password recovery

- Real email accounts: `/forgot-password` → Resend link (requires `RESEND_*` configured).
- Synthetic emails: recovery email will not reach a mailbox — regenerate SH credential or re-invite teacher / set password via supported admin flows.

A School Head does not have to stay in that second bucket. While they can still
sign in, **Settings → Security → change email** swaps the synthetic `sh@…`
address for a real one (`changeEmailAction` re-verifies the current password,
refuses an address another account already holds, and updates Supabase Auth and
Prisma together, rolling Auth back if the local write fails). After that the
account is a real-email account and `/forgot-password` reaches them — so this is
worth doing *before* a lockout rather than after one. It also moves that head to
the server-side grant path described below, which spends the deployment IP
budget rather than the browser’s.

The **Email address** field on Settings → Profile is a different thing: the
survey contact address on `SchoolHeadProfile.contactEmail` (P-I4), shown beside
the read-only *Sign-in identity*. Editing it changes nothing about login, and
clearing it removes the stored address.

## "The password is right and it still won't log in"

Before resetting anything, check whether Supabase Auth — not the password — is
refusing. Its password grant is rate limited **per source IP**, ~30 requests per
5 minutes on the default settings, and it answers `HTTP 429 over_request_rate_limit`.
A reset cannot fix that, because the credential was never wrong.

How to tell them apart:

- `/admin/audit` → the `LOGIN_DENIED` row's `reason`. `rate_limited` means the
  limiter; `incorrect_credentials` means the password. (Rows written before
  2026-09-10 always say `incorrect_credentials` — that field could not
  distinguish the two, which is what made this hard to diagnose.)
- Several *different* schools failing inside the same few minutes is the
  signature of a shared bucket, not of several forgotten passwords.
- The server log carries the verbatim Supabase message (`supabase rate limit:`).
- Two read-only scripts read the same evidence without a dashboard login:

  ```powershell
  npm run diagnose:login -- salimama kawas         # account health: Prisma row vs Supabase auth user
  npm run diagnose:login-trail -- salimama kawas   # the LOGIN_* trail, and who else failed in those minutes
  ```

  `diagnose:login` is the one that rules the account out: a head whose auth user is
  present, confirmed, unbanned, and email-matched is not broken, so look at the limiter.

What to do:

1. Tell the school to stop retrying and wait ~5 minutes. Every retry re-arms the
   window.
2. Raise the limit: **Supabase Dashboard → Authentication → Rate Limits →
   "Sign in / Sign up"**. The default of 30 per 5 min is sized for one person,
   not for a division of ~330 schools logging in at the same time of morning.
3. Set `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` in Vercel if they
   are unset. Without them LITRACK's own limiter degrades to a per-instance
   window (it logs `[rate-limit] … not an effective limit` once), so a retry
   loop is never stopped before it reaches Supabase.

Sign-in itself is made **by the browser**, not by the server action, so each
person spends their own IP budget rather than the deployment's — see
`src/lib/actions/login.ts`. Two paths still grant server-side and therefore
still share the Vercel egress budget: Super Admin login, and School Heads whose
account uses a real email address instead of the synthetic `sh@…` one.

## Import / export ops notes

- Teachers import CSV under `/teacher/grade/[id]/import` (valid rows commit).
- Exports are tenant-scoped; audit `IMPORT_LEARNERS` / `EXPORT_*` for counts and filters, not full PII dumps.
- Prefer Excel for operational dumps; printable report for meetings (browser Print → PDF).

## School roster: bulk import and targeted delete

Both scripts read `.env.local` (or an already-exported shell), are **dry-run by default**,
and print what they would do before you add `--commit`. They prefer `DIRECT_URL` but probe
it first and fall back to the pooled `DATABASE_URL`, because a Supabase project without the
IPv4 add-on has an IPv6-only direct host that most networks cannot reach.

**Import the DepEd School Heads workbook** (creates a `School` + a `SCHOOL_HEAD` user per
row, School ID as the initial password, `mustChangePassword` forced):

```powershell
npm run db:import-schools -- --file "path\to\List-of-School-Heads-....xlsx"            # dry run
npm run db:import-schools -- --file "path\to\...xlsx" --commit                          # apply
```

It skips any row whose School ID **or** name already exists, so it is safe to re-run and
safe to run against a database that already holds a live school. `--wipe` (which also
demands `--i-understand-this-deletes-all-data`) destroys every school and all learner data
with it — you almost never want it; delete specific schools instead:

```powershell
npm run db:delete-schools -- --school 305402 --school "Some School Name"                # dry run
npm run db:delete-schools -- --school 305402 --commit                                    # apply
```

`--school` is repeatable and takes a School ID or an exact name; a token matching zero or
several schools aborts rather than guessing. It deletes the Supabase auth identities first
and stops if any of them fails, then removes the whole subtree in one transaction, then
asserts that unnamed schools and `schoolId = null` accounts are untouched. `AuditLog` is
deliberately never deleted. **Both `--commit` paths are irreversible — read the dry run.**

**After either `--commit`, a running server keeps serving the old school list for up to 60
seconds.** `listSchoolsWithTeacherStatus` (`src/lib/actions/school.ts`) is wrapped in
`cachedQuery` with `revalidate: 60` under the `schoolsList` tag, and a CLI script has no way
to call `revalidateTag`. Wait a minute or restart the server before concluding the import
did nothing.

Newly imported schools also leave the login screen's **Teachers** button disabled, by design:
`teachersOpen` requires an active School Head who has completed profiling *and* at least one
grade level. Each head unlocks their own school by signing in (School ID, forced password
change) and adding grade levels. The **School Head** button needs only a selected school.

## Backup / restore pointers (Supabase)

1. **Backups:** Supabase Dashboard → Database → Backups (plan-dependent). Enable PITR on paid tiers if available.
2. **Export:** Logical dumps via Supabase tooling / `pg_dump` against a direct connection (credentials from Dashboard — do not commit).
3. **Restore:** Follow Supabase restore docs for the project plan; verify app env still points at the restored project; re-run `prisma migrate deploy` only if schema drift requires it.
4. After restore, smoke: admin login, one school head, one teacher grade list.

## A user quotes a reference E-XXXXXXXX

**When:** someone reports an error and gives you a reference like `E-7K2P9QXM`
(shown only for "system"-severity failures — our side broke, not theirs).

1. Go to `/admin/errors?ref=E-7K2P9QXM` (Super Admin only). This shows the
   code, severity, route, school, admin-only message, stack trace (if any),
   and user id for that one event, under an expandable **Details** section.
2. If nothing matches — the row aged out, or the event fired before the
   `ErrorEvent` migration was applied — search the Vercel runtime logs for
   the reference instead. Every recorded event is also written as a JSON
   line tagged `"tag": "litrack.error"`, and that line is written before the
   database insert, so it survives even a database outage.
3. Rows are kept for `ERROR_EVENT_RETENTION_DAYS` days (default 30), then
   purged by the daily backup cron (`/api/cron/backup`) — so an old
   reference may simply be gone.
4. What the severity on the row means: `system` is our failure (this is the
   only kind that ever gets a reference); `security` is a correctly refused
   request (an access check, a rate limit, another school's row) that was
   recorded but never shown a reference; `user` mistakes (wrong password, a
   blank field) aren't recorded here at all.
5. A failure email only reaches you if `ERROR_ALERT_EMAIL` is set (along
   with `RESEND_API_KEY` / `RESEND_FROM_EMAIL`) — without it, this page and
   the Vercel logs are the only way to learn about a `system` failure. At
   most one email per error code is sent every 15 minutes, so a sustained
   outage won't flood the inbox.

## Incident checklist (auth / data leak suspicion)

1. Disable affected users (`isActive` / soft delete) and rotate Supabase service role + Resend keys if exposed.
2. Review `/admin/audit` for anomalous `LOGIN_*`, `EXPORT_*`, `ADMIN_SCHOOL_VIEW`.
3. Rotate SH credentials / revoke pending invites as needed.
4. Document timeline; follow `docs/privacy.md` for personal data handling.

## Migrations

Never apply remote migrations without approval. Command: `npx prisma migrate deploy` with direct URL. Details: `docs/migrations.md`.

## Local `next dev` console notes

- **Prisma SQL flood:** Query logging is off by default. Set `PRISMA_LOG_QUERIES=1` only when debugging SQL (`src/lib/prisma.ts`).
- **`npm run build` fails with `EPERM ... rename query_engine-windows.dll.node` while `next dev` is running.** The dev server holds the Prisma query engine open, so the `prisma generate` step of the build cannot replace it. Stop the dev server and re-run, or — when the schema has not changed, so the generated client is already current — build to the scratch dist dir instead, which also stops the build from trampling the dev server's `.next`:

  ```powershell
  $env:NEXT_BUILD_DIST_DIR = ".next-verify"; npx next build
  ```

  Such a build rewrites two tracked files to point at the scratch dir: it appends `.next-verify/types/**/*.ts` to `tsconfig.json` (reformatting the whole file), and repoints the `reference path` in `next-env.d.ts`. Both edits are unwanted — `git checkout -- tsconfig.json next-env.d.ts` afterwards.

  This EPERM is **not** a blocked verification. `prisma generate` writes `node_modules/.prisma/client/index.d.ts` before it swaps the native engine, so the TypeScript types are already current when the rename fails — check the file's mtime rather than assuming the client is stale. The DLL itself only changes when the *Prisma version* changes, not when the schema does, so a schema-only change leaves the existing engine correct and typecheck / lint / test / build all run against fresh types. Even after the EPERM, run the four gates instead of stopping.
- **Webpack PackFileCacheStrategy “Serializing big strings …”:** Harmless Next 14.2 / webpack filesystem-cache noise when packing large compiled modules (often CSS or dependency graphs). This repo has no large JSON/base64/env strings inlined into client modules. Do **not** switch webpack `cache` to `memory` just to silence it — that slows rebuilds. Safe to ignore unless cold compiles regress badly.
