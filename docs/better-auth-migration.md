# Better Auth + R2 migration — design spec

Source: architect run wf_33ec9f7f-85e (2026-10-04). Binding for every lane of the better-auth-neon task. Better Auth docs facts are in the appendix.


Worktree: `C:/Users/PC5/Desktop/litrack-better-auth` (v2.35.0, HEAD 7cf9cbf). I changed no files. Every database query was read-only (`default_transaction_read_only=on`) and returned counts only.

### 0. What I found (this shapes the plan)

| Fact | Value | Why it matters |
|---|---|---|
| Rows in `auth.users` | 5,280. All are `$2a$10$` bcrypt. 0 have no password, 0 SSO, 0 anonymous, 0 MFA, 0 phone. 1 unconfirmed email. All lowercase. **0 fail Zod v4 `z.email()`** | Every hash can be verified with bcrypt. Better Auth's `signInEmail` email validation accepts every address. |
| Providers in `auth.identities` | `email` only (5,280) | One credential account per user. No OAuth. |
| Link to `public.User` (Neon) | 5,273 live Users ↔ 5,273 auth users, exactly 1:1. 231 soft-deleted Users (230 TEACHER, 1 SUPER_ADMIN) have no auth user. 7 auth users have no User row (abandoned registrations). 0 email mismatches. `User.authId` is `text` | Better Auth user id = existing `authId`. No `User` rewrite needed. |
| `raw_app_meta_data.role` | Null on 15 users, including all 4 SUPER_ADMIN | Backfill the role from `User.role`, never from app_metadata. |
| Supabase is not fully read-only | `postgres` role has `default_transaction_read_only=on`, but `supabase_auth_admin` does not. Newest Supabase session is 06:38 UTC today; 267 auth rows updated and 14 created in the last 24h | Supabase Auth is still live and taking password changes and sign-ups. The backfill must run again after deploy. |
| Neon | Has only the `public` schema (no `auth`, no dblink). Latest migration `20261003000003` = repo latest. `neondb_owner` bypasses RLS | `hasRecentRecoveryToken` (reads `auth.one_time_tokens`) silently returns false in prod today. The backfill has to be a script, not SQL. |
| Hyperdrive | Both `HYPERDRIVE` (cached) and `HYPERDRIVE_FRESH` (cache disabled) point at Neon `ep-cool-river…neon.tech` | `prismaFresh` is the correct client for session reads. |
| Worker env | Secrets: CRON_SECRET, DATABASE_URL, DIRECT_URL, GEMINI_API_KEY, PASSWORD_VAULT_KEY, RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY, BLOB_READ_WRITE_TOKEN. **No UPSTASH_*** | Rate limits run per isolate, in memory. Today Supabase's per-IP limiter is the real brute-force backstop, and it goes away. |
| Avatars | Public bucket `avatars`: 268 objects (134 full + 134 `_128`), about 2.95 MB. 134 Users have `avatarPath`; 0 point at a missing object. `avatarPath` stores the **object key, not a URL** | No database rewrite. Only the URL builder's base changes. |
| `.env.local` `DIRECT_URL` | Points at `*.pooler.supabase.com`. Neon is in `.env.neon` `NEON_DIRECT_URL` | Applying the migration with default env would hit the wrong database. |
| R2 | `open-next.config.ts`: "R2 is not enabled on the account" | Enabling R2 is an operator prerequisite. |
| Better Auth | Latest 1.7.7. Peer deps allow next ^16, react ^19, prisma ^6. Ships its own zod v4 dependency | Compatible. Pin `1.7.7` exactly. |

### 1. Capability map: each Supabase use and what replaces it

| File | Supabase capability used | Replacement |
|---|---|---|
| `src/middleware.ts`, `src/lib/supabase/middleware.ts` | `createServerClient` cookie refresh; `getClaims` + JWKS → `{sub, app_metadata.role}` | `readEdgeSession(request)` in new Edge-safe `src/lib/auth/auth-cookies.ts`: `getSessionCookie` (existence) + `getCookieCache` (HMAC-verified compact cookie) → `user.role`. Middleware no longer refreshes anything. Expires leftover `sb-*` cookies. |
| `src/lib/supabase/jwks.ts`, `client.ts`, `server.ts`, `admin.ts`, `env.ts` | JWKS cache in KV; browser, SSR and service-role clients; env checks | Delete. Use `getAuth()` / `getAuthSession()` / `identity.ts` / `isAuthConfigured()`. |
| `src/lib/supabase/avatar-storage.ts` | `storage.upload` ×2 (upsert false), `storage.remove` | `src/lib/storage/avatar-objects.ts` on R2 binding `AVATARS` (`put` / `delete`). |
| `src/lib/auth/session.ts` | `getClaims`; `signOut` on deleted, rejected and inactive users; impersonation proof | `getAuthSession()`. Teardown = `revokeAllSessions(authId)` + `endCurrentSession()`. `isVerifiedImpersonationOf(user.id)`. |
| `src/lib/auth/impersonation.ts` | HMAC ticket keyed by the service-role key; `getSession` + `getUser` + `getClaims` `session_id` binding | New `src/lib/auth/impersonation-session.ts` built on the admin plugin's `session.impersonatedBy`, plus an allowlisted `returnTo` cookie. Old file deleted in T14. |
| `src/lib/auth/recovery-email.ts` | `admin.generateLink(recovery)`; read of `auth.one_time_tokens` | `src/lib/auth/password-reset.ts` (`issueResetToken`, `hasRecentResetToken`) + existing Resend `sendEmail`. |
| `src/lib/auth/delete-auth-user.ts` | `admin.deleteUser`; fallback raw `DELETE FROM auth.users` | Same signature, body becomes `identity.deleteIdentity` (idempotent, cascades). |
| `src/lib/auth/teacher-registration.ts` | `updateUserById` app_metadata | `identity.setRole`. |
| `src/lib/auth/test-lab.ts`, `src/lib/actions/presence.ts` | `readBoundImpersonationSession(supabase.auth)` | `readImpersonation()`. |
| `src/lib/auth/login-gates.ts`, `src/app/admin/login/page.tsx` | `assertSupabaseConfigured` / `isSupabaseConfigured` | `assertAuthConfigured` / `isAuthConfigured`. |
| `src/lib/actions/auth.ts` | `signInWithPassword` ×6 (SH, teacher, admin, unknown-handle probe, current-password check ×2); `signOut` global/local; `getUser`; `getSession`; `updateUser(password)` ×3; `admin.createUser`; `admin.updateUserById(email)` + rollback | `signInWithPassword()` wraps Better Auth `signInEmail` (cookies via `nextCookies`). `identity.verifyAccountPassword`. `identity.setPassword` / `setEmail` in the **same** `$transaction` as the `User` write. Reset via `consumeResetToken`. Logout = `endCurrentSession` + `revokeAllSessions`. The probe becomes a dummy bcrypt verify. |
| `src/lib/actions/login.ts` | Server halves of the browser grant (`getUser`, `signOut`) | Delete `begin*` / `finish*` / `reportLoginFailure`. They existed only to dodge Supabase's per-IP limit. |
| `src/lib/actions/accounts.ts` | `updateUserById(password, app_metadata)` ×2; `generateLink(magiclink)` + `verifyOtp` + `setSession` (impersonate); the same to switch back; `admin.signOut(jwt, local)` | `identity.setPassword` + `setRole`. `startImpersonationSession` / `stopImpersonationSession` (admin plugin `impersonateUser` / `stopImpersonating`, which also deletes the impersonated session, so it is single-use). |
| `src/lib/actions/school.ts` | `admin.createUser`; `updateUserById` (app_metadata, password) | `identity.createIdentity` inside the school-create transaction; `identity.setPassword`. |
| `src/lib/actions/school-head.ts` | `updateUserById` app_metadata (approval); `deleteAuthUser` ×2 | `identity.setRole`. `deleteAuthUser` unchanged (its body changes). |
| `src/lib/actions/admin-archive.ts` | `admin.deleteUser`; `removeAvatarObjects` | `identity.deleteIdentity`; import from `@/lib/storage/avatar-objects`. |
| `src/lib/actions/avatar.ts` | storage; `readImpersonationContext` | Storage module; `readImpersonation()`. |
| `src/lib/db/account-reset.ts` | `updateUserById(password)`; `deleteUser` | `identity`. |
| `src/lib/demo/provision.ts`, `test-fixtures.ts` | `listUsers`, `createUser`, `updateUserById`, `deleteUser` | `identity.findIdentityByEmail` / `create` / `setPassword` / `delete`. |
| `src/lib/demo/session.ts` | Service-role key as HMAC key | `HKDF(BETTER_AUTH_SECRET, "litrack.demo-session.v1")`. |
| `src/lib/errors/classify.ts`, `src/lib/errors/supabase.ts` | `isAuthError`, `mapSupabaseAuthError`, `isAuthServiceUnreachable` | `src/lib/errors/auth-provider.ts`: `isAuthApiError` (Better Auth `APIError`), `mapAuthError`. `LOGIN_FAILURE_REASONS` and `loginFailureReasonFor` move as-is. |
| `src/lib/errors/session-cookie.ts` | Decode `sb-*-auth-token` JWT `sub` (label only) | Decode `litrack.session_data` compact payload `session.user.id` (still unverified, still a label). |
| `src/lib/auth/session-end.ts` | `hasSupabaseSessionCookie` | `hasAuthSessionCookie` + `hasLegacySupabaseCookie`. |
| `src/lib/env.ts`, `.env.example`, `.github/workflows/ci.yml` | `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` required; service-role key | `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_AVATAR_BASE_URL`. |
| `src/lib/avatars/paths.ts` | `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/avatars/<key>` | `${NEXT_PUBLIC_AVATAR_BASE_URL}/<key>`. |
| `src/app/auth/confirm/verify/route.ts` | `verifyOtp(recovery)` + `getUser` | `peekResetToken` (does not consume) → httpOnly `litrack_reset` cookie (path `/auth`, max-age = remaining token life) → 303 to `/auth/reset`. |
| `src/app/auth/reset/page.tsx` | `exchangeCodeForSession` + `getUser` | `peekResetToken(cookie)`. The PKCE `?code=` branch is deleted. |
| `src/app/{teacher/(app),school-head/(app),district}/layout.tsx` | `readBoundImpersonationSession(supabase.auth)` | `readImpersonation()`. |
| `src/components/forms/login-form.tsx` | Browser `signInWithPassword` ×2; `mapSupabaseAuthError` | Server actions `loginSchoolHead` / `loginTeacher` only. |
| `src/components/admin/impersonation-notice.tsx` | as above | `readImpersonation()`. |
| `scripts/*.ts` (11) and `prisma/seed.ts` | `admin.*` and raw `auth.users` SQL | `identity-rows.ts` + `password-hash.ts` with a script-owned PrismaClient. `tsconfig` includes `**/*.ts`, so these break typecheck if left. |
| Tests (44 files) | `vi.mock("@/lib/supabase/…")` | Mock `@/lib/auth/{auth-session,identity,impersonation-session}` and `@/lib/storage/avatar-objects`. |

### 2. Architecture

**Server config: `src/lib/auth/better-auth.ts`** (`server-only`). `getAuth()` is a lazy singleton built on the first call, never at import (same reason as `src/lib/prisma.ts`). Config:
- `database: prismaAdapter(prismaFresh, { provider: "postgresql" })`. Fresh reads always; never the cached Hyperdrive binding.
- `secret: BETTER_AUTH_SECRET`, `baseURL: canonicalAppUrl()`, `telemetry: { enabled: false }`, `rateLimit: { enabled: false }`.
- Model names: `user: { modelName: "authUser" }`, `session: { modelName: "authSession", expiresIn: 30d, updateAge: 1d, cookieCache: { enabled: true, maxAge: 300, strategy: "compact", version: "1" } }`, `account: { modelName: "authAccount", accountLinking: { enabled: false } }`, `verification: { modelName: "authVerification" }`. The adapter indexes `db[modelName]`, so these must be the camelCase Prisma delegate names.
- `emailAndPassword: { enabled: true, disableSignUp: true, requireEmailVerification: false, password: { hash: hashPassword, verify: verifyPassword } }`.
- `advanced: { cookiePrefix: "litrack", useSecureCookies: authCookiesSecure(), database: { generateId: "uuid" }, ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"] } }`.
- `plugins: [admin({ adminRoles: ["SUPER_ADMIN"], defaultRole: "TEACHER", roles: { SUPER_ADMIN: adminAc, SCHOOL_HEAD: userAc, TEACHER: userAc, DISTRICT_ADMIN: userAc }, impersonationSessionDuration: 7200 }), nextCookies() /* must be last */]`. The `roles` map is required: `hasPermission` only knows `admin` / `user` by default, so `SUPER_ADMIN` would be denied.
- **No `/api/auth/[...all]` route is mounted.** Every call is server-side `auth.api.*` from inside our wrapped actions, so no Better Auth endpoint can bypass LITRACK's gates, rate limits or audit.

**Password hashing: bcrypt everywhere** (`src/lib/auth/password-hash.ts`, pure, also used by scripts). `bcryptjs` ^3, cost 10 (`$2b$10$`). Verify accepts `$2a$` / `$2b$` / `$2y$` and returns false for anything else. Why bcrypt rather than Better Auth's default scrypt:
- One verify path.
- Same CPU profile as today's hashes.
- New hashes are GoTrue-compatible, so a rollback can sync them back losslessly.
- Better Auth only uses native `node:crypto` scrypt when it detects Node/Bun/Deno; on workerd it can fall back to pure-JS `@noble` scrypt, which costs more CPU.

Expected cost is roughly 60–150 ms CPU per hash or verify on workerd (estimate, not measured). Workers Paid with `cpu_ms: 300000` is fine; the Free tier's 10 ms limit would fail. Add a 72-byte cap to `strongPassword` because bcrypt silently truncates past that.

**Prisma models** (T1; new tables only):
- `AuthUser { id String @id; name String; email String @unique; emailVerified Boolean @default(false); image String?; role String?; banned Boolean? @default(false); banReason String?; banExpires DateTime?; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt; sessions AuthSession[]; accounts AuthAccount[] }`
  - `name` is always `""`. `User.fullName` is authoritative; an empty name means no drift and a smaller cookie.
- `AuthSession { id String @id; expiresAt DateTime; token String @unique; createdAt; updatedAt; ipAddress String?; userAgent String?; userId String; impersonatedBy String?; user AuthUser @relation(onDelete: Cascade); @@index([userId]) }`
- `AuthAccount { id String @id; accountId String; providerId String; userId String; accessToken String?; refreshToken String?; idToken String?; accessTokenExpiresAt DateTime?; refreshTokenExpiresAt DateTime?; scope String?; password String?; createdAt; updatedAt; user AuthUser @relation(onDelete: Cascade); @@unique([providerId, accountId]); @@index([userId]) }`
- `AuthVerification { id String @id; identifier String; value String; expiresAt DateTime; createdAt; updatedAt; @@index([identifier]) }`
- `User` gets **no column change and no foreign key**. Only the `authId` doc comment changes. A foreign key is deliberately left out: 231 deleted Users keep dangling `authId`s, and `restoreRemovedTeacher` relies on that.
- Migration `prisma/migrations/20261004000001_better_auth_tables/migration.sql` creates the tables, indexes and inter-Auth foreign keys, plus `ENABLE ROW LEVEL SECURITY` ×4. Add the same 4 lines to `prisma/rls-policies.sql` (enforced by `tests/unit/rls-coverage.test.ts`).
- `src/lib/db/schema-order.ts`: add all 4 models to `SNAPSHOT_MODELS` with `operational: false, inSnapshot: false`, placed after `User`. That means credentials never land in a backup, a restore never deletes identities (it never touched Supabase Auth before either), and "clear operational data" never touches them.

**Mapping `getCurrentUser` / `requireUser`** (`src/lib/auth/session.ts`):
- `getAuthSession({fresh?})` = `cache()`'d `auth.api.getSession({ headers: await headers(), query: { disableCookieCache: fresh } })`.
- `getCurrentUserCached`: session → `session.user.id` (= authId) → existing `loadUserByAuthId` with its retry. The span names stay.
- The deleted, rejected and inactive gates stay byte-identical. Teardown becomes `revokeAllSessions(authId)` (a database delete, which works in an RSC) followed by a best-effort `endCurrentSession()`. `nextCookies` swallows RSC cookie writes.
- Deactivation still takes effect on the next request whatever the cookie cache says, because the `User` row is re-read every request.
- `requireUser`, `requireSchoolUser`, Super Admin role pass-through and the `mustChangePassword` logic do not change. `isVerifiedImpersonationOfUser` becomes `isVerifiedImpersonationOf(user.id)`: a fresh session with `impersonatedBy != null` and `session.user.id === user.authId`.

**Middleware role on the Edge path** (`src/lib/auth/auth-cookies.ts`: no Prisma, no `server-only`):
- `token = getSessionCookie(req, { cookiePrefix: "litrack" })`.
- `cache = getCookieCache(req, { cookiePrefix, secret: process.env.BETTER_AUTH_SECRET, strategy: "compact", isSecure: authCookiesSecure() })` inside try/catch.
- `user = token ? { id: cache?.user.id ?? null, role: parseAppMetadataRole(cache?.user.role) } : null`.
- When the cookie cache has expired (more than 5 minutes since the last server action), role is null and the request passes through. That is the existing "legacy role-less" path, and `requireUser` stays authoritative.
- `hadSession = hasAuthSessionCookie || hasLegacySupabaseCookie`, so the forced sign-out shows `?reason=session_expired`. Expire the `sb-*` cookies on that response.
- `authCookiesSecure()` is the single helper deciding the `__Secure-` prefix (from `NEXT_PUBLIC_APP_URL` starting with `https`). Better Auth's config and the middleware both call it. Stay on `middleware.ts`; Next 16 `proxy.ts` forces the Node runtime (confirmed in `node_modules/next/dist/docs/.../proxy.md`).

**Flows:**
- **Sign-in** (`loginSchoolHead` / `loginTeacher` / `loginAdmin`): existing gates → `signInWithPassword(email, pw)` (`auth.api.signInEmail({ body: { email, password, rememberMe: true }, headers })`; `INVALID_EMAIL_OR_PASSWORD` → `AUTH_INCORRECT_PASSWORD`) → same audit rows, `recordLastLogin`, warm routes, `redirect`. The admin unknown-handle probe becomes `verifyPassword({ hash: DUMMY_BCRYPT, password })`; keep the 800 ms floor. Add a per-IP **failure** ceiling for SH and teacher sign-in mirroring `ADMIN_FAILED_IP_RATE`.
- **Sign-out** (`logoutAction`, unwrapped): fresh session. If `impersonatedBy` is set: `endCurrentSession()` (that session only) and expire `litrack.admin_session` plus the return cookie. Otherwise: `endCurrentSession()` then `revokeAllSessions(authId)`. This keeps today's Supabase default of global sign-out. Same audit rows.
- **Change password**: `identity.verifyAccountPassword(authId, current)` (wrong → `AUTH_CURRENT_PASSWORD_INCORRECT`). Hash outside the transaction, then one `prismaFresh.$transaction` holding `setPassword` + `passwordChangeFields`. After the commit, `revokeOtherSessions(authId, currentToken)` signs out every other session and keeps the caller signed in (review finding, 2026-10-07). A reset revokes all sessions before its auto sign-in, and the admin set-password paths below revoke all sessions of the target account.
- **Forced set-password**: the same, without the current-password check.
- **Reset**: `requestPasswordReset` keeps its gates (synthetic emails skipped, active only). `issueResetToken(authId)` deletes older `reset-password:` rows for that user (keeps "only the newest email works"), stores `identifier = "reset-password:" + sha256(token)` with `value = authId` and a 1h expiry, and emails `${origin}/auth/confirm?token=…`. The confirm page stays a non-consuming GET. The verify POST route does peek + cookie. `completePasswordReset` reads the cookie and, in one transaction, calls `consumeResetToken` (`deleteMany` must return count = 1), `setPassword` and `passwordChangeFields`; then signs in with the new password and redirects to the role home. The cooldown reads `AuthVerification.createdAt`.
- **Admin set-password** (`resetSchoolHeadPasswordToDefault`, `issueRandomPassword`, school head regenerate, account-reset, demo): `identity.setPassword` (+ `setRole` where app_metadata used to be written). It throws `IDENTITY_NOT_FOUND` when no AuthUser exists (restored teachers); the callers map that to the same AppError they raise today. It writes through Prisma, not the admin plugin's `setUserPassword`, because School ID passwords are 6 digits (below Better Auth's minimum length) and many callers have no admin session.
- **Create user** (school create, teacher register, scripts, demo): `identity.createIdentity({ email, password, role }, tx)` → uuid authId, inside the same transaction as `User.create`. Teacher register keeps the adopt path: an existing AuthUser with the same email and a matching password is adopted. Then `signInWithPassword` sets the session.
- **Delete user**: `identity.deleteIdentity(authId)` (cascade; a missing row counts as ok).
- **Email change**: `setEmail` + `User.email` in one transaction. The rollback branch and `AUTH_EMAIL_PARTIAL_UPDATE` become dead code; remove them.
- **Impersonation**: `startImpersonation` keeps every refusal (role allow-list, sign-in head check, stranding guard, rate limit), then `auth.api.impersonateUser({ body: { userId: target.authId }, headers })`. That one response creates a 2h session with `impersonatedBy = admin authId`, stores the admin token in signed `litrack.admin_session`, and swaps the session cookie, so there is no stranding window. It also sets an allowlisted `litrack_impersonation_return=test-lab` cookie, then audits `IMPERSONATION_START`.
  - `endImpersonation`: fresh session; `impersonatedBy` must be set; re-query `User { authId: impersonatedBy, role: SUPER_ADMIN, isActive, deletedAt: null }` (Better Auth doesn't re-check this); `auth.api.stopImpersonating({ headers })` (deletes the impersonated session, restores the admin's); audit `IMPERSONATION_END`; redirect `impersonationReturnPath`.
  - `readImpersonation()` returns `{ adminAuthId, adminUserId, targetUserId, returnTo, expired: false }` from the cookie-cached session; `adminUserId` is resolved only when impersonating.
  - Behaviour change: when the 2h impersonation session expires the admin is signed out, instead of staying in the target session with only the return blocked.

**Email**: the existing Resend `sendEmail`. No Better Auth mailer.

**Audit**: no new actions. `LOGIN_SUCCESS`, `LOGIN_DENIED`, `LOGOUT`, `PASSWORD_CHANGE`, `PASSWORD_RESET_REQUEST`, `EMAIL_CHANGE`, `IMPERSONATION_START/END` and `SCHOOL_HEAD_PASSWORD_RESET_DEFAULT` keep their call sites; `SECURITY_AUDIT_ACTIONS` is unchanged.

**Secrets**:
- `BETTER_AUTH_SECRET`: new Worker secret, at least 32 bytes.
- `PASSWORD_VAULT_KEY`: already set in prod. **Must-not:** delete the `SUPABASE_SERVICE_ROLE_KEY` secret in this ship. The vault falls back to deriving from it if `PASSWORD_VAULT_KEY` is ever malformed. Remove it in a later cleanup.

### 3. Invariants and where each is enforced

| # | Invariant | Enforced by |
|---|---|---|
| I1 | Every live User has an AuthUser with `id = User.authId` and one credential AuthAccount | Database: `User.authId @unique`, `AuthAccount @@unique([providerId, accountId])`. App: `createIdentity` inside the `User.create` transaction. Cutover gate: verification SQL. No foreign key, by choice (dangling authIds on deleted users). |
| I2 | `AuthUser.email` = `User.email` | Database: `AuthUser.email @unique`. App: `setEmail` in the same transaction (the only writer is `changeEmailAction`). Test pins it. |
| I3 | `AuthUser.role` = `User.role` | Type: `createIdentity` requires a role. `setRole` at every role writer. Backfill verification. Middleware is non-authoritative. Drift can cause a redirect loop: AuthUser.role TEACHER with User.role SCHOOL_HEAD bounces between `/school-head` and `/teacher`. |
| I4 | Credentials are bcrypt only, never in backups, logs or audit | One hasher (pure function + unit test) wired into both the Better Auth config and `identity`. `inSnapshot: false` (schema-order test). Audit rule unchanged. |
| I5 | Session and credential reads never come from the Hyperdrive cache | Adapter built on `prismaFresh`. New invariant test: `prisma.auth*` / `prismaFresh.auth*` may appear only in `src/lib/auth/{better-auth,identity,password-reset,auth-session}.ts`. |
| I6 | No Better Auth HTTP surface | Test: no `src/app/api/auth/**`, no `toNextJsHandler` import. `disableSignUp: true`. |
| I7 | Impersonation is proven only by DB `impersonatedBy`; Super Admins cannot be impersonated | Existing refusals + `allowImpersonatingAdmins: false` + the admin re-query in `endImpersonation`. |
| I8 | Middleware stays Edge-safe | `auth-cookies.ts` / `roles.ts` import no Prisma and no `server-only` (import test). |
| I9 | Reset tokens are single-use, newest-only, stored hashed | `consumeResetToken` count = 1 inside the transaction; delete-older on issue (unit tests). |
| I10 | Avatar key shape unchanged | Existing SQL CHECK `User_avatarPath_shape` + `isValidAvatarPath`. |
| I11 | No `@supabase/*` anywhere | T14 grep gate + a repo-invariant test. |

### 4. Data migration (backfill)

`scripts/backfill-better-auth-users.ts`. It is cross-database (Neon has no dblink), idempotent, and supports `--dry-run` / `--apply`.
1. **Source**, Supabase `DIRECT_URL`, read-only session: `select id::text, lower(email), encrypted_password, email_confirmed_at is not null, created_at at time zone 'UTC', updated_at at time zone 'UTC' from auth.users where encrypted_password like '$2%'`.
2. **Target**, Neon `NEON_DIRECT_URL`: `select "authId", email, role from "User"`.
3. **Plan**, pure `planAuthBackfill(src, users)`:
   - Join on authId.
   - Use `User.email` as the email (that's what sign-in passes to Better Auth) and report any mismatch with the Supabase email (currently 0).
   - Use `User.role` as the role.
   - Skip auth users with no User row (expect 7) and report Users with no auth user (expect 231, all deleted).
   - Rows come from `buildIdentityRows`: AuthUser `{ id: authId, name: "", email, emailVerified, role, banned: false, createdAt, updatedAt: src.updated_at }`; AuthAccount `{ id: authId, accountId: authId, providerId: 'credential', userId: authId, password: hash, createdAt, updatedAt: src.updated_at }`.
4. **Write**: one transaction, batches of 500. `INSERT … ON CONFLICT (id) DO UPDATE SET … WHERE "AuthUser"."updatedAt" < EXCLUDED."updatedAt"`, and the same for AuthAccount (`password`, `updatedAt`).
   - Newer wins, so it is safe to re-run before and after cutover. After cutover, app writes stamp `now()`, which is newer than any frozen Supabase `updated_at`, so a late re-run cannot clobber a Better Auth-era password.
   - Supabase sessions are not copied (forced sign-out).
5. **Verify** (Neon, script prints them; expected result in brackets):
   - Live Users with no AuthUser [0]: `select count(*) from "User" u where u."deletedAt" is null and not exists (select 1 from "AuthUser" a where a.id = u."authId")`
   - Email or role mismatches [0]: `select count(*) from "User" u join "AuthUser" a on a.id = u."authId" where a.email <> u.email or a.role <> u.role::text`
   - AuthUsers with no bcrypt credential [0]: `select count(*) from "AuthUser" a where not exists (select 1 from "AuthAccount" c where c."userId" = a.id and c."providerId" = 'credential' and c.password like '$2_$%')`
   - `count(*) "AuthUser"` [5,273 + sign-ups since]
   - Source/target parity line.
   - The dry run against current data should print create = 5,273, orphans = 7, live-without-auth = 0.

### 5. R2 plan

- **Binding**: `"r2_buckets": [{ "binding": "AVATARS", "bucket_name": "litrack-avatars" }]` in `wrangler.jsonc`.
- **Public reads**: the bucket is public via a custom domain, `avatars.arallitrack.com` (Cloudflare CDN, no Worker CPU per view). Same privacy model as today's public Supabase bucket; keys are `<userId>/<uuid>` and not guessable. `NEXT_PUBLIC_AVATAR_BASE_URL` must be set in **both** the Workers Builds build env (it is inlined at build time) and the runtime vars.
- **Upload / delete**: `src/lib/storage/avatar-objects.ts`, same API (`putAvatarObjects`, `removeAvatarObjects`, same no-throw and cleanup-on-thumb-failure semantics):
  - `env.AVATARS.put(key, bytes, { httpMetadata: { contentType: sniffedMime, cacheControl: "public, max-age=86400" } })`. Optionally add `onlyIf` If-None-Match `*` (to be confirmed in R2 docs); a fresh uuid per upload already prevents overwrites.
  - `env.AVATARS.delete(keys)`.
  - Without a binding (plain `next dev`), throw `AVATAR_STORAGE_FAILED` with a `CONFIG_MISSING` detail.
- **URL builder**: `avatarPublicUrl(path, variant, base = process.env.NEXT_PUBLIC_AVATAR_BASE_URL)` → `${base}/${encodedKey}`. **No database rewrite**, because `avatarPath` stores keys.
- **Copy**: `scripts/copy-avatars-to-r2.ts` (idempotent, `--dry-run` / `--apply`):
  - List keys from `storage.objects where bucket_id='avatars'` (read-only SQL).
  - GET each from the public Supabase URL, then PUT to R2 through the S3 API (`aws4fetch` dev dependency; `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` live only in `.env.local`), keeping content-type and setting cache-control. Skip a key if HEAD shows the same size.
  - Verify: 268 keys, and both the full and `_128` object exist for every Neon `User.avatarPath` (134).
  - Leave the Supabase objects in place (deleting them is a later, owner-approved step).

### 6. Production cutover (zero lost writes) and rollback

**Prerequisites (operator)**
1. Enable R2, create `litrack-avatars`, attach `avatars.arallitrack.com`.
2. `wrangler secret put BETTER_AUTH_SECRET`.
3. Add `NEXT_PUBLIC_AVATAR_BASE_URL` to the build and runtime env.
4. Upstash secrets (see open question 1).
5. Record the current version id (`da6acc23-…` as of now).

**Cutover**
1. **Migration (additive: 4 tables + indexes)**: `DIRECT_URL=$NEON_DIRECT_URL DATABASE_URL=$NEON_DIRECT_URL npx prisma migrate status` must list exactly 1 pending, `20261004000001_better_auth_tables`; then `migrate deploy`. Old code ignores the new tables, so this is safe at any time.
2. **Backfill #1** (`--apply`) and **avatar copy #1**. Run the verification SQL.
3. **Preview**: `npm run build` (WORKERS_CI=1) then `wrangler versions upload` (no traffic). Smoke-test: SH with the 6-digit School ID, a teacher, an admin by username, password change, reset email, impersonate and return, Test Lab, avatar upload and render. The preview shares the prod database, which is harmless.
4. Low-traffic window: run local gates, **backfill #2**, then push main (release entry included).
5. **As soon as the new version serves 100%**: **backfill #3** and **avatar copy #2**. These catch password changes, registrations and uploads that reached Supabase during the build window. Re-run the verification SQL.
6. Watch `/admin/errors` for `AUTH_*` and `AVATAR_STORAGE_FAILED` for 24h.

Everyone signs in once (Supabase cookies are ignored and expired, with the `session_expired` message). The release modal explains it.

**Rollback**
- Code: `wrangler rollback` to the recorded version (or `versions deploy <old>@100%`).
- Supabase Auth was never written, so the old logins work again. Everyone is signed out a second time.
- What is lost unless synced back:
  - Better Auth-era password changes. They are bcrypt and GoTrue verifies them, but syncing them back means writing `auth.users.encrypted_password`, which needs owner approval because Supabase `postgres` is read-only.
  - Accounts created after cutover (they exist only in AuthUser).
  - Avatars uploaded to R2 after cutover (they would 404 on Supabase URLs; optional copy-back).
- Leave the new tables in place (no DROP).

### 7. Lane matrix

Every row's acceptance includes, besides what is listed: `node "C:/Users/PC5/.claude/hooks/gate-slot.mjs" light --cwd "C:/Users/PC5/Desktop/litrack-better-auth" -- npm run typecheck` → exit 0 and `-- npm run lint` → exit 0.

| Row | Owner · model | Write surface (exact) | After | Acceptance (command → expected) | Must-not |
|---|---|---|---|---|---|
| **T1 CONTRACT: schema** | database-engineer · sonnet | `prisma/schema.prisma`, `prisma/migrations/20261004000001_better_auth_tables/migration.sql`, `prisma/rls-policies.sql`, `src/lib/db/schema-order.ts` | — | `npx prisma validate` → 0. `npx prisma generate` → 0. `npx vitest run tests/unit/rls-coverage.test.ts tests/unit/db/schema-order.test.ts` → pass. `prisma migrate diff --from-schema-datamodel <HEAD schema in temp> --to-schema-datamodel prisma/schema.prisma --script` → only CREATE TABLE/INDEX/FK for `Auth*`. `grep -E 'ALTER TABLE "(User\|School)"\|DROP' migration.sql` → no match | Change `User` columns; add a foreign key from `User.authId`; apply to any database; touch `seed.ts` |
| **T2 CONTRACT: core auth API** | backend-developer · opus | New: `src/lib/auth/{password-hash,identity-rows,better-auth,auth-session,identity,auth-cookies,password-reset,impersonation-session}.ts`, `src/lib/errors/auth-provider.ts`. Edit: `package.json`, `package-lock.json` (add `better-auth@1.7.7`, `bcryptjs@^3.0.3`), `src/lib/env.ts` (add optional `BETTER_AUTH_SECRET`, `NEXT_PUBLIC_AVATAR_BASE_URL`) | T1 | gates green; `npm run test` → no regressions (additive); `grep -rn "toNextJsHandler\|api/auth" src` → none | Delete or alter any Supabase module or consumer; mount a route handler; use `prisma` (cached) for Auth models |
| **T3 session + edge** | backend · sonnet | `src/lib/auth/session.ts`, `src/middleware.ts`, `src/lib/auth/session-end.ts`, `src/lib/auth/login-gates.ts`, `src/lib/errors/session-cookie.ts`, `src/lib/errors/classify.ts`, `src/app/admin/login/page.tsx` | T2 | gates; `grep -n "supabase" <those files>` → none | Import Prisma or `server-only` into the middleware graph; rename to `proxy.ts` |
| **T4 credential flows** | backend · opus | `src/lib/actions/auth.ts`, `src/lib/actions/login.ts` (delete browser-grant exports), `src/lib/auth/recovery-email.ts`, `src/app/auth/confirm/verify/route.ts`, `src/app/auth/reset/page.tsx` (data part), `src/lib/validators/auth.schema.ts` (72-byte cap) | T2, T8a | gates; grep supabase in those files → none | Change audit actions or metadata; return tokens in URLs past `/auth/confirm` |
| **T5 impersonation + admin credential ops** | backend · opus | `src/lib/actions/accounts.ts`, `src/lib/auth/test-lab.ts`, `src/lib/actions/presence.ts`, `src/app/teacher/(app)/layout.tsx`, `src/app/school-head/(app)/layout.tsx`, `src/app/district/layout.tsx` (data lines only) | T2 | gates; grep supabase / `@/lib/auth/impersonation"` in those files → none | Drop any refusal in `startImpersonation`; skip the admin re-query |
| **T6 account lifecycle writers** | backend · sonnet | `src/lib/actions/school.ts`, `src/lib/actions/school-head.ts`, `src/lib/actions/admin-archive.ts` (auth + storage import only), `src/lib/auth/teacher-registration.ts`, `src/lib/auth/delete-auth-user.ts` (body only, same signature), `src/lib/db/account-reset.ts` | T2, T7 | gates; grep supabase → none | Resurrect `isActive` on password reset (existing HIGH backlog item) |
| **T7 R2 avatars** | backend · sonnet | New `src/lib/storage/avatar-objects.ts`; `src/lib/supabase/avatar-storage.ts` → re-export shim; `src/lib/avatars/paths.ts`; `src/lib/actions/avatar.ts`; `wrangler.jsonc` (`r2_buckets`) | T2 | gates; `grep -rn "storage/v1" src` → none | Change the key shape or the CHECK; store URLs in the DB |
| **T8a login form** | frontend-developer · sonnet | `src/components/forms/login-form.tsx` | — | gates; grep `createSupabaseBrowserClient\|beginTeacherLogin\|finish.*Login\|reportLoginFailure` → none | Change visible copy beyond removed paths |
| **T8b impersonation UI** | frontend · sonnet | `src/components/admin/impersonation-notice.tsx` (+ `impersonation-banner.tsx` if the type changes) | T2 | gates | Any auth logic in components |
| **T10 demo** | backend · sonnet | `src/lib/demo/{provision,test-fixtures,session}.ts` | T2 | gates | Reuse the service-role key as a signing key |
| **T11a ops scripts** | backend · sonnet | `scripts/{set-super-admin-credentials,seed-division-admins,create-district-admins,reset-district-admin-passwords,create-e2e-admin,import-schools,delete-schools,retire-super-admin,diagnose-login}.ts`; delete `scripts/cleanup-passwordless-teachers.ts` (0 passwordless users exist; Better Auth has none) | T2 | gates | Import `server-only` modules; print passwords |
| **T11b seed** | database-engineer · sonnet | `prisma/seed.ts` | T2 | gates; `npx tsx prisma/seed.ts` against a Neon **branch** → prints the admin login | Run against prod |
| **T12 backfill + avatar copy scripts** | backend · opus | New `scripts/backfill-better-auth-users.ts`, `scripts/copy-avatars-to-r2.ts` | T2 | `npx tsx scripts/backfill-better-auth-users.ts --dry-run` → create = 5,273, orphans = 7, live-without-auth = 0, writes 0. `--apply` on a Neon branch, then re-run → 0 changes | Write to Supabase; log hashes or URLs |
| **T13a tests: session / edge / errors** | qa-test-engineer · sonnet | `tests/unit/{supabase-jwks,supabase-admin-key}.test.ts` (delete), `supabase-middleware-session.test.ts` → `edge-session.test.ts`, `errors/session-cookie`, `errors/classify`, `auth/session-db-retry`, `auth-helpers`, `t8-error-reporting`, `impersonation-notice-wiring`, `auth/{impersonation-must-change-password,impersonated-district-scope,test-lab,admin-accounts-page-guard,developer-admin-guard,district-admin-surfaces}` + new invariant tests I5, I6, I8, I11 | T3, T5, T8b | `npx vitest run tests/unit/auth tests/unit/errors tests/unit/edge-session.test.ts` → pass | Edit `src/**` |
| **T13b tests: credential flows** | qa · sonnet | `tests/unit/actions/{login-begin,admin-login,auth-dry-run,auth-password-vault-wiring,request-password-reset-cooldown,request-password-reset-origin,skip-password-impersonation}.test.ts`, `auth/{recovery-email,auth-confirm-page,auth-confirm-route}`, `tests/components/{login-form-failures,auth-reset-page}.test.tsx` + new password-hash (bcrypt `$2a$10$` compatibility), password-reset, identity-rows tests | T4, T8a | those files pass | — |
| **T13c tests: account ops** | qa · sonnet | `tests/unit/actions/{accounts,reveal-school-head-password,role-matrix,school-head-credential-reset,school-head-profile-save,school-head-remove-teacher,school-restore,extension-school-default-password,grade-level-archive,district-school-management,admin-archive,presence}.test.ts`, `tests/unit/db/account-reset-teacher-removal.test.ts` | T5, T6 | those pass | — |
| **T13d tests: avatar / demo / backfill** | qa · sonnet | `tests/unit/actions/avatar.test.ts`, `demo-provision`, `demo-test-fixtures` + new avatar-objects, paths, `planAuthBackfill` tests | T7, T10, T12 | those pass | — |
| **T14 removal + release** | backend · sonnet | Delete `src/lib/supabase/**`, `src/lib/auth/impersonation.ts`, `src/lib/errors/supabase.ts`, empty `login.ts`. `src/lib/env.ts` (drop Supabase vars), `.env.example`, `.github/workflows/ci.yml` placeholders, `package.json` + lock (remove `@supabase/*`, version 2.36.0), `src/lib/releases.ts` entry (`announce: true`) | T3–T13d | `grep -rn "@supabase/\|lib/supabase" src scripts prisma tests e2e` → none; full gates: typecheck, lint, `npm run test`, `npm run build` → 0; Workers build bundle under the 10 MB compressed limit | Touch the vault key logic; remove the Worker secret |
| **T15 integration** | qa · sonnet | `e2e/**` only if needed | T14 | Neon branch with migration + backfill; `npm run dev` with branch URLs; `PLAYWRIGHT_BASE_URL=http://localhost:3000 npm run test:e2e -- school-head-login smoke tenancy-isolation` → pass; manual SH / teacher / admin / impersonation checklist | Point at production |
| **T16 docs** | lead · sonnet | `docs/{deployment,runbook,privacy,migrations}.md`; `CLAUDE.md` only with owner approval | T2 | review | — |
| **T17 cutover** | lead + operator | none (runbook in section 6) | T14, T15 | Verification SQL 0/0/0; parity counts; prod smoke | Run migrate with `.env.local` `DIRECT_URL` (that's Supabase); delete Supabase data or secrets |

Rows that can run in parallel: T1 with T8a; then T3, T4 (once T8a is done), T5, T7, T8b, T10, T11a, T11b, T12, T16 after T2 (T6 waits for T7); the T13x rows once their sources land.

### 8. Alternatives rejected

- **Neon Managed Auth**: password hashes cannot be imported, which breaks the locked decision.
- **New Better Auth ids plus a mapping**: needs a mass update of 5,273 `User.authId` values (not additive) or a mapping table everywhere, for no gain.
- **scrypt for new hashes**: two verify paths, no lossless rollback, and risk of the pure-JS fallback on workerd. I would revisit only if bcrypt measures over 300 ms CPU on workerd.
- **Mounting `/api/auth/[...all]` with client-side sign-in**: exposes sign-up, sign-in and admin endpoints that bypass the school/approval gates, the app rate limiter and audit; Better Auth's own limiter is per isolate on Workers. The per-IP reason for browser sign-in is gone with Supabase.
- **Keeping the HMAC ticket**: `session.impersonatedBy` is server-side, bound to one session row, and single-use through `stopImpersonating`.
- **Admin plugin `setUserPassword` / `createUser`**: needs an admin session in headers (fails for self-registration, School Head approval, scripts) and enforces a minimum length the 6-digit School ID fails.
- **Better Auth's reset endpoints**: stores the raw token and does not invalidate older ones; the own module keeps the token hashed, keeps "newest only", and is atomic with `passwordChangeFields`.
- **Serving avatars through a Worker route**: costs Worker CPU on every view.

### 9. Open questions (business or ops decisions the code can't answer)

1. **Rate limiting**: production has no `UPSTASH_REDIS_REST_URL/_TOKEN`, so every limit is per isolate. Provision Upstash (zero code; `rate-limit.ts` already supports it) **before cutover**, or knowingly accept weaker brute-force protection?
2. **R2**: may R2 be enabled on the account, and is `avatars.arallitrack.com` acceptable as the public avatar domain?
3. **Session lifetime**: Supabase sessions effectively never expired. Is a 30-day sliding expiry (refreshed by any server action) acceptable?
4. **Cutover window**: who runs it, and when (low traffic, Manila time)?
5. **Rollback approval**: does the owner pre-approve writing Better Auth-era bcrypt hashes back into Supabase `auth.users` if a rollback happens?

### 10. Risks, with concrete failure scenarios

- **R1 HIGH – rate limits are per isolate.** With no Upstash, an attacker spreading attempts across isolates gets about 10 tries per isolate per 5 minutes on each teacher email. Supabase's per-IP limit, the backstop today, is removed.
- **R2 MEDIUM – Workers CPU for hashing.** Each sign-in or password set is one bcrypt (about 0.1 s CPU, estimated). 1,000 failed attempts a minute is about 100 CPU-seconds a minute of billed CPU. Not a limit problem on Paid; a Free plan would fail.
- **R3 MEDIUM – Hyperdrive cache.** If any Auth read used `prisma` (cached HYPERDRIVE), a session deleted by `stopImpersonating` or sign-out could still be returned for about 60 s. Example: return-to-admin, then a replayed cookie still works. Mitigated by the `prismaFresh` adapter and test I5.
- **R4 MEDIUM – cookie cache staleness.** A session revoked by global sign-out on another device is still accepted for up to 5 minutes. Deactivation is not affected (the `User` row is re-read every request).
- **R5 MEDIUM – cookie and database expiry drift.** `nextCookies` skips refresh on RSC requests, and full-page GETs extend the database row but cannot set the cookie. A user who only browses, with no server action for 30 days, is signed out.
- **R6 MEDIUM – build window.** A password changed on Supabase between backfill #2 and the new version going live fails on Better Auth until backfill #3. Run #3 immediately.
- **R7 MEDIUM – Edge secret.** If OpenNext does not expose `BETTER_AUTH_SECRET` to middleware, `getCookieCache` fails and role stays null: no login bounce, role-prefix gate silently off (`requireUser` still protects). The same failure happens if the `__Secure-` flag is computed differently in middleware and in Better Auth. Verify on the preview; use one shared `authCookiesSecure()`.
- **R8 MEDIUM – role mirror drift.** AuthUser.role ≠ User.role causes a redirect loop between role homes for up to the cache age. Verification SQL must be 0.
- **R9 MEDIUM – wrong database.** `.env.local` `DIRECT_URL` points at Supabase; `migrate deploy` with defaults hits the wrong database (it fails, because `postgres` is read-only). Always set the Neon URL explicitly.
- **R10 MEDIUM – rollback losses.** Better Auth-era passwords, new accounts and new avatars are lost on rollback unless synced back (open question 5).
- **R11 LOW – bundle size.** Better Auth brings kysely, jose and zod v4; check the Worker size in T14.
- **R12 LOW – leftover cookies.** Chunked `sb-*` cookies inflate headers until middleware expires them.
- **R13 LOW – bcrypt 72-byte truncation.** Handled by the validator cap.
- **R14 LOW – session table growth.** AuthSession rows carry IP and user agent and grow; add an expired-row cleanup to the nightly cron later.

### Findings (existing issues uncovered while investigating)

1. **HIGH** – `src/lib/rate-limit.ts:222` fallback is live in production: the Worker has no `UPSTASH_*` vars (checked with `wrangler versions view`). Once Supabase's per-IP limiter is removed, sign-in brute-force protection is per-isolate memory only. Confirmed. This blocks cutover unless accepted (open question 1).
2. **MEDIUM** – `.env.local` `DIRECT_URL` and `DATABASE_URL` point at Supabase while production is Neon. CLAUDE.md's "confirm which database" step is load-bearing here. Confirmed.
3. **MEDIUM** – Supabase Auth is still taking writes (`supabase_auth_admin` is not read-only; sign-ins and 14 sign-ups in the last 24h). Any one-shot backfill would lose writes. Confirmed.
4. **LOW** – `src/lib/auth/recovery-email.ts:53-66`: `hasRecentRecoveryToken` queries `auth.one_time_tokens`, which does not exist on Neon, so the reset cooldown is silently off in production today. Confirmed.
5. **LOW** – `src/lib/auth/delete-auth-user.ts:60`: the SQL fallback `DELETE FROM auth.users` fails on Neon. Only reached when the service-role key is invalid. Confirmed.
6. **LOW** – `wrangler.jsonc` Hyperdrive comments and names (`litrack-supabase`, "origin is Supabase's direct host") are stale; both point at Neon. `open-next.config.ts` says R2 is not enabled. Confirmed.


## Appendix: Better Auth docs facts (docs-lookup)

Now let me compile all findings with proper citations.

## FINDINGS

**Latest Stable Version:** Better Auth version 1.6.9 (released October 2024) — [npm better-auth 1.6.9](https://newreleases.io/project/npm/better-auth/release/1.6.9)

### 1. Next.js App Router Setup

**Route handler at `app/api/auth/[...all]/route.ts`:**
```typescript
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const { GET, POST } = toNextJsHandler(auth);
```
[How can I implement better auth on a Next.js app router project?](https://forums.basehub.com/better-auth/better-auth/4)

**nextCookies plugin for server actions:**
Add to Better Auth config: `plugins: [nextCookies()]` — this automatically sets cookies when `Set-Cookie` headers are present, required because server actions cannot set cookies without this plugin.
[Next.js integration](https://www.better-auth.com/docs/integrations/next)

**Getting session in server actions with `auth.api.getSession()` and `headers()`:**
```typescript
import { auth } from "@/lib/auth"
import { headers } from "next/headers"

const session = await auth.api.getSession({
    headers: await headers()
})
```
[Next.js integration](https://www.better-auth.com/docs/integrations/next)

### 2. Prisma Adapter

**Setup with PostgreSQL:**
```typescript
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
});
```
[Better Auth Setup and Configuration](https://makerkit.dev/docs/tanstack-prisma/better-auth/setup)

**Required models and CLI generation:**
Better Auth requires User, Session, Account, and Verification models. Generate with:
```bash
npx @better-auth/cli@latest generate --config ./lib/auth.ts --adapter prisma
```
The CLI automatically adds all required fields to `prisma/schema.prisma`. Then run migrations with `npx prisma migrate dev`.
[Better Auth Setup and Configuration](https://makerkit.dev/docs/tanstack-prisma/better-auth/setup)

**Required fields (generated by CLI):**
- **User**: id, name, email, emailVerified, image, createdAt, updatedAt, relations to Session and Account
- **Session**: id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId
- **Account**: linking OAuth/provider accounts
- **Verification**: email verification and password reset tokens
[Better Auth Setup and Configuration](https://makerkit.dev/docs/md/tanstack-prisma/better-auth/setup)

### 3. Password Hashing & Supabase Migration

**Default:** Better Auth uses **scrypt** for password hashing (slow and memory-intensive).

**Custom hash/verify options in emailAndPassword:**
```typescript
emailAndPassword: {
  enabled: true,
  password: {
    hash: async (password: string) => string,
    verify: async ({ password, hash }) => boolean
  }
}
```
[Email & Password](https://www.better-auth.com/docs/authentication/email-password)

**Migrating bcrypt hashes from Supabase:**
The official Supabase migration guide instructs to install bcrypt and configure custom hash/verify functions. Rather than rehashing all passwords, configure Better Auth to verify the existing bcrypt hashes:
```typescript
import bcrypt from "bcrypt"

password: {
  hash: (password) => bcrypt.hash(password, 10),
  verify: ({ password, hash }) => bcrypt.compare(password, hash)
}
```
This preserves existing Supabase bcrypt hashes without forcing password resets.
[Migrating from Supabase Auth to Better Auth](https://canary.better-auth.com/docs/guides/supabase-migration-guide)

### 4. Admin Plugin

**Available functions:**
- **createUser** — Creates new users with email, password, name, roles, custom data
- **setUserPassword** — Sets or updates user password, creates credential account if needed
- **removeUser** — Hard delete user from database
- **banUser** — Blocks sign-in, revokes all sessions, optional expiration time
- **impersonateUser** — Creates admin session mimicking another user (default 1 hour duration, configurable via `impersonationSessionDuration`)
- **setRole** — Changes user role assignment

**Role storage:**
Roles stored as "comma-separated string" in user table. Users can have multiple roles. Admin plugin requires authenticated user with `admin` role or membership in `adminUserIds` config list.
[Admin Plugin](https://www.better-auth.com/docs/plugins/admin)

### 5. Session Cookie Cache & Middleware

**session.cookieCache configuration:**
```typescript
session: {
    cookieCache: {
        enabled: true,
        maxAge: 5 * 60  // 5 minutes, recommended
    }
}
```
Stores session data in a signed `session_data` cookie. Avoids database calls for `useSession()` and `getSession()` within the cache window by validating the cryptographically signed cookie.
[Session Management](https://www.better-auth.com/docs/concepts/session-management.md)

**Reading session in middleware without DB:**
Use `getSessionCookie()` for optimistic redirects based on cookie presence. This works in Edge Runtime (cannot make database calls in Edge). Full session validation still requires a database call.
[Session Management](https://better-auth.com/docs/concepts/session-management.md)

**Caveat:** Revoked sessions remain active until cache expires (shorter `maxAge` reduces this window).

### 6. Cloudflare Workers / workerd Compatibility

**Scrypt CPU limitation issue:**
Scrypt can hit CPU time limits on Cloudflare Workers. Mitigation strategies:
- Use Service Binding with a dedicated Worker handling password hashing via RPC (offloads hashing)
- Replace scrypt with a faster alternative for Workers
[Show GN: Better Auth migration with Cloudflare Workers hash template](https://news.hada.io/topic?id=27399)

**Bcryptjs alternatives for Workers:**
- **bcrypt-edge** — Re-implemented bcrypt for web workers / Cloudflare, available as bundleable ESM
- **cfw-bcrypt** — bcrypt.js modified for Cloudflare (removes Node dependencies)
- **bcrypt-wasi** — Wraps Rust bcrypt via WASI (compatible with workerd)
[Better-Auth Cloudflare Workers Compatibility](https://npmjs.com/package/bcrypt-edge)

**Node.js crypto API now available:** Full `node:crypto` module is now available in Cloudflare Workers, improving cryptographic support.
[2025-04-08 nodejs crypto and tls](https://developers.cloudflare.com/changelog/post/2025-04-08-nodejs-crypto-and-tls/)

### 7. Username Plugin

**Database modifications:**
Adds two fields to user table:
- **username** — normalized (typically lowercase) for unique identification and sign-in
- **displayUsername** — original non-normalized username for display (configurable)

**Setup:**
1. Import and add `username()` plugin to server auth config (requires `emailAndPassword` enabled)
2. Run `npx auth migrate` to add fields to schema
3. Add `usernameClient()` plugin to client config

**Configuration options:**
- minUsernameLength (default 3), maxUsernameLength (default 30)
- Custom username validator function
- Username normalization strategy
- Immutable usernames option
[Username Plugin](https://www.better-auth.com/docs/plugins/username)

**Email-less accounts:** The username plugin **does not support truly email-less accounts** — it requires email and password authentication to be enabled. It allows sign-in with username instead of email, but email remains required in the system.
[Username Plugin](https://www.better-auth.com/docs/plugins/username)

---

