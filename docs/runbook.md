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
- **Webpack PackFileCacheStrategy “Serializing big strings …”:** Harmless Next 14.2 / webpack filesystem-cache noise when packing large compiled modules (often CSS or dependency graphs). This repo has no large JSON/base64/env strings inlined into client modules. Do **not** switch webpack `cache` to `memory` just to silence it — that slows rebuilds. Safe to ignore unless cold compiles regress badly.
