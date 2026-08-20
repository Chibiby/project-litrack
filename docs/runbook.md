# Operations runbook — PROJECT LITRACK

Operational procedures for admins. Does not replace training or legal advice.

## Regenerate School Head activation credential

**When:** SH lost credential / locked out / synthetic email cannot receive reset mail.

1. Super Admin → `/admin/schools` → select school → regenerate credential action.
2. Copy the one-time credential shown (displayed once).
3. Deliver out-of-band (secure channel). SH logs in → forced password change.
4. Confirm audit: `SCHOOL_HEAD_CREDENTIAL_REGENERATED`.

Never store the plaintext credential in tickets or chat logs long-term.

## Teacher invite: resend / revoke

**Resend:** School Head → Teachers → resend invite. Regenerates credential/token; previous link invalidated as designed. Email sent when invite has a real address; otherwise show on-screen credential.

**Revoke:** School Head → revoke invite. Sets `revokedAt`; accept path rejects. Audit: `TEACHER_INVITE_RESEND` / `TEACHER_INVITE_REVOKE`.

If the teacher already activated, use password reset (real email) or Super Admin/school-head account disable patterns (`isActive` / soft delete) rather than invite revoke.

## Password recovery

- Real email accounts: `/forgot-password` → Resend link (requires `RESEND_*` configured).
- Synthetic emails: recovery email will not reach a mailbox — regenerate SH credential or re-invite teacher / set password via supported admin flows.

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
