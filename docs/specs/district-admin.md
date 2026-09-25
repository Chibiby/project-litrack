# Spec — District Admin role and the shared division summary

Status: proposed · 2026-09-24 · owner review needed on section 11 before Wave 3
Source: operator brief + `ADMIN-PORTAL-DATA.docx` ("ADMIN PORTAL": Division view for the main admin and Sir John; per-district view for the 14 district admins)

> Location note: this repo has kept specs at `docs/*-spec.md` and `docs/superpowers/specs/`. This file lives at `docs/specs/` because the task asked for that path; nothing else depends on the location.

---

## 1. The problem

The division office supervises about 339 schools in 23 districts. Today it has one kind of administrator, the Super Admin, who sees and can change every school. Fourteen district supervisors each look after one to three districts. They need to:

- see the learner, reading, attendance, end-of-term, compliance and profiling figures for their own districts, as totals and school by school, and export them for DepEd paperwork;
- keep their schools running: switch a school on or off, reset a School Head's sign-in, and fix the school's details;
- answer help requests from their schools, send announcements to them, move learners between their schools, and reopen submission windows.

They must never see or change anything about a school outside their districts. That is the same "worst bug we can ship" as cross-school leakage (CLAUDE.md, Tenancy), one level up.

The division office (the Super Admin accounts, including `john`, "Sir John") needs the same figures division-wide, by district and by school. The figures have to come from one set of components and one set of queries, so the division total and the sum of the district views cannot disagree.

Non-goals, named so nobody builds them by accident:

- District admins do **not** enter School Head or teacher pages. They do not pass `requireUser("SCHOOL_HEAD")`, they do not impersonate, and they have no `?schoolId=` drill-down into `/school-head/*`. Per-school detail is the aggregated per-school summary in their own portal (see 13, alternative D).
- No learner-level lists (names, PII) in the district portal. Summaries hold counts and percentages only.
- No chat. `ADMIN_DIRECT` stays a line to the division team.
- No change to the two division-wide switches (`submissions.locking`, `submissions.readingLevelUnlockAll`). They stay Super Admin only.
- No self-service district assignment UI in this slice (extension point, Q14).

---

## 2. Fixed facts the design rests on

| Fact | Where verified |
|---|---|
| `School.district` is free text, nullable, whitespace-collapsed (`formatOptionalLabel`), case kept as typed | `prisma/schema.prisma` School; `src/lib/names.ts`; migration `20260908000003_normalize_existing_data` |
| Three write paths set `School.district`: `createSchool` (Super Admin), `updateSchoolInfo` (**School Head**, free text), `scripts/import-schools.ts` (create-only, skips existing schools) | `src/lib/actions/school.ts`, `src/lib/actions/school-management.ts:26`, `scripts/import-schools.ts:449` |
| There is no Super Admin "edit school" action today | grep of `SCHOOL_UPDATE` call sites |
| `requireUser(roles)` lets `SUPER_ADMIN` through every role list; anything else not in the list is redirected to `roleHomePath(role)` | `src/lib/auth/session.ts` |
| Middleware reads the role from JWT `app_metadata.role`; role-less legacy JWTs pass through | `src/lib/supabase/middleware.ts`, `src/lib/auth/roles.ts` |
| `loginAdmin` resolves `User.username` → email, restricted to `role: "SUPER_ADMIN"` before and after sign-in | `src/lib/actions/auth.ts:469` |
| The three division accounts (`john`, `brandan`, `dante`) are `SUPER_ADMIN` rows with synthetic emails `<username>@SYNTHETIC_EMAIL_DOMAIN` and **no** `app_metadata.role` | `scripts/seed-division-admins.ts` |
| Cross-school transfer has no request/approval table. The Super Admin performs it directly | `transferLearnerCrossSchool`, `src/lib/actions/enrollment.ts:288` |
| `Announcement.schoolId` is required; announcements are read only on School Head pages | schema; grep of readers |
| `SUPPORT_TICKET_SUBMITTED` notifications are written for Super Admins but **no bell renders them** | `src/lib/actions/support.ts:120`; `src/app/admin/layout.tsx` passes chat notifications only |
| Attendance and monthly reading records exist for **ARAL learners only** | `src/lib/actions/attendance.ts:70`; ARAL grid writers |
| Adding an enum value must be alone in its migration file | `20260911000013_unlock_granted_notification_type` |
| New tables enable RLS in their migration and in `prisma/rls-policies.sql`; `tests/unit/rls-coverage.test.ts` enforces it | |
| Every model must be placed in `SNAPSHOT_MODELS`; `tests/unit/db/schema-order.test.ts` enforces it | `src/lib/db/schema-order.ts` |
| Next 16: `middleware.ts` is deprecated in favour of `proxy.ts`, and the repo deliberately keeps `middleware.ts` (CLAUDE.md). `searchParams` is a `Promise`. `unstable_cache` is superseded by `use cache` in the docs, but the house standard is `cachedQuery`, so this design stays on `cachedQuery` | `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/middleware.md`, `.../04-functions/unstable_cache.md` |

---

## 3. The shape

### 3.1 Data model

**Decision: a `DistrictAdminAssignment` table keyed by the district string. No `District` table, and no change to `School`.**

```prisma
enum UserRole {
  SUPER_ADMIN
  SCHOOL_HEAD
  TEACHER
  DISTRICT_ADMIN            // new, appended
}

/// Which districts a DISTRICT_ADMIN supervises. `district` is the exact,
/// canonical `School.district` string: a join by value, not a foreign key,
/// because `School.district` is free text (spec section 13, alternative A).
/// Read only for users whose role is DISTRICT_ADMIN (`requireAdminScope`);
/// rows on any other role grant nothing. Composite PK, same shape as TeacherSection.
/// SQL-only CHECK `DistrictAdminAssignment_district_canonical`: preserve it.
model DistrictAdminAssignment {
  userId      String
  district    String
  createdAt   DateTime @default(now())
  /// Plain column, no relation: same shape and reason as School.createdById.
  createdById String?

  user User @relation("DistrictAdminAssignments", fields: [userId], references: [id], onDelete: Cascade)

  @@id([userId, district])
  @@index([district])
}

model User {
  // ...
  districtAssignments DistrictAdminAssignment[] @relation("DistrictAdminAssignments")
}

model Announcement {
  // ...
  /// Groups the per-school copies of one district/division broadcast. NULL =
  /// written by the school's own School Head, which is what every existing row
  /// already means. Non-null rows are read-only to School Heads.
  broadcastId String?
  @@index([broadcastId])
}
```

NULL check (principle: nullable columns are not free):
- `DistrictAdminAssignment` has no nullable key column. The PK `(userId, district)` is all NOT NULL, so the uniqueness cannot be defeated by NULLs.
- `Announcement.broadcastId` NULL means "school-authored". Only a plain index sits on it, no unique, so NULLs are harmless.

User rows for district admins: `role = DISTRICT_ADMIN`, `schoolId = NULL`, `username` set (e.g. `ferdinand.simon`), `email = <username>@<SYNTHETIC_EMAIL_DOMAIN>` (synthetic, so `isSyntheticEmail` already reports "no mailbox"), `isActive = true`, `profileCompleted = true`, `mustChangePassword = true`.

### 3.2 Migrations (all additive — Claude may apply per CLAUDE.md after `prisma migrate status`)

| # | Folder | SQL outline | Category |
|---|---|---|---|
| M1 | `20260925000001_user_role_district_admin` | `ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DISTRICT_ADMIN';`. **Alone in the file.** Nothing in it may use the value. | Additive (enum value) |
| M2 | `20260925000002_district_admin_assignment` | `CREATE TABLE "DistrictAdminAssignment"` (`userId` TEXT NOT NULL, `district` TEXT NOT NULL, `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, `createdById` TEXT) with PK `("userId","district")`, FK `userId` to `"User"("id")` ON DELETE CASCADE ON UPDATE CASCADE, and a CHECK named `DistrictAdminAssignment_district_canonical`: district is non-empty and equals `btrim(regexp_replace(district, '\s+', ' ', 'g'))`. Plus `CREATE INDEX` on `district` and `ALTER TABLE "DistrictAdminAssignment" ENABLE ROW LEVEL SECURITY;` | Additive (new, empty table) |
| M3 | `20260925000003_announcement_broadcast_id` | `ALTER TABLE "Announcement" ADD COLUMN "broadcastId" TEXT;` and `CREATE INDEX "Announcement_broadcastId_idx" ON "Announcement"("broadcastId");` | Additive (nullable column + index), no backfill |

Generate each file with `prisma migrate diff --script` using file inputs only, then hand-add the CHECK and the RLS line. Also add the ENABLE ROW LEVEL SECURITY line for `DistrictAdminAssignment` to `prisma/rls-policies.sql`. The policy is deny-all like `SystemSetting`.

Nothing destructive is proposed. The only tightening this design mentions is an FK from `School.district` to a `District` table (13.A). It is rejected, and it would need owner approval because it constrains a populated column.

### 3.3 Auth and routing

**Route prefix: `/district`.** Constants go in `src/lib/routes/district.ts` (`DISTRICT_ROUTES`), following `src/lib/routes/school-head.ts`.

| File | Change |
|---|---|
| `src/lib/auth/roles.ts` | `AppRole` adds `"DISTRICT_ADMIN"`. `roleHomePath` returns `"/district"`, which also gives `/district/settings`, `/district/settings/profile` and `/district/settings/security` through the existing helpers. `parseAppMetadataRole` accepts it. `enforceRolePrefix`: add `needsDistrict` (the path is `/district` or starts with `/district/`). Allow `DISTRICT_ADMIN` and `SUPER_ADMIN`; redirect anyone else to their home. The existing admin, school-head and teacher checks already send a `DISTRICT_ADMIN` to `/district`, because the role is not in their allow-lists. `authedLoginRedirect` needs no change: it sends a signed-in district admin loading `/login` or `/admin/login` to `/district`. |
| `src/middleware.ts` | Unauthenticated redirect: the area is `"admin"` when the path starts with `/admin` **or** `/district`, in both the `!isSupabaseConfigured()` branch and the `!user` branch. Do **not** rename to `proxy.ts`. |
| `src/lib/auth/session.ts` | `requireUser`: `isAdminRoute` is true when roles include `SUPER_ADMIN` **or** `DISTRICT_ADMIN`, so an unauthenticated district visitor lands on `/admin/login`. `getCurrentUser` needs no new gate. The existing `deletedAt` and `isActive` sign-outs cover district admins. |
| `src/lib/actions/auth.ts` `loginAdmin` | Pre-lookup role filter `in ["SUPER_ADMIN", "DISTRICT_ADMIN"]`. Post-sign-in check uses the same set. Audit `metadata.role = user.role`; the unknown-username row says `"ADMIN_CONSOLE"`. Redirect `roleHomePath(user.role)`. Warm routes by role (add a district list in `src/lib/auth/warm-routes.ts`). The error copy stays generic. |
| `src/lib/actions/auth.ts` `skipPasswordChange` | Refuse `DISTRICT_ADMIN` as well as `TEACHER`. The one-time password travelled in a CSV, so it must be retired at first sign-in. |
| `logoutAction` | Unchanged (redirects to `/login`, as it does for Super Admins today). See Q13. |
| `src/lib/auth/password-vault.ts` | Unchanged. `passwordChangeFields` already seals only `SCHOOL_HEAD`. |

The `/admin/login` page stays one form for both admin roles. Change the copy to "Division and district admin sign-in". The forgot-password hint for synthetic accounts reads "Ask the division office to reset your password".

### 3.4 Scope enforcement (the part that must not leak)

There are two new modules. The pure one decides; the server one fetches facts and calls it.

**`src/lib/auth/admin-scope.ts`: pure, no Prisma client calls, unit-tested**

```ts
export type AdminScope =
  | { kind: "division" }                                   // SUPER_ADMIN only
  | { kind: "districts"; districts: readonly string[] };  // DISTRICT_ADMIN, sorted, deduped

export type SummaryScope =                                // what a page or export looks at
  | { kind: "all" }                                        // everything the AdminScope allows
  | { kind: "districts"; districts: readonly string[] }
  | { kind: "school"; schoolId: string };

/** The one place a role becomes a scope. */
export function adminScopeFor(role: UserRole, assignedDistricts: string[]): AdminScope | null;
//   SUPER_ADMIN    -> { kind: "division" }
//   DISTRICT_ADMIN -> { kind: "districts", districts: sorted(unique(assigned)) }  (empty: sees nothing)
//   anything else  -> null   (caller throws AUTH_FORBIDDEN)

/** Prisma School filter. The only function that turns a scope into a WHERE. */
export function schoolWhereForScope(scope: AdminScope): Prisma.SchoolWhereInput;
//   division  -> { deletedAt: null }        (+ demoSchoolFilter applied by the caller, see 3.6)
//   districts -> { deletedAt: null, isDemo: false, district: { in: [...districts] } }
//   Prisma `in: []` matches no rows, so an admin with no assignments sees nothing (fail closed).

/** Throws resourceNotFound("School", { crossTenant: true, detail }): same words as a missing row. */
export function assertSchoolInScope(
  scope: AdminScope,
  school: { district: string | null; isDemo: boolean } | null
): void;

/** Narrows a requested view to what the caller may see. Out-of-scope district -> NOT_FOUND (security). */
export function resolveSummaryScope(
  scope: AdminScope,
  requested: { district?: string; schoolId?: string }
): SummaryScope;
//   A requested schoolId comes back as { kind: "school" } and MUST then pass loadSchoolInScope.

/** Cache key fragment. Same scope gives the same key, whatever order the districts came in. */
export function scopeCacheKey(scope: AdminScope | SummaryScope, demoVisible: boolean): string;
```

**`src/lib/auth/district-scope.ts`: `server-only`**

```ts
/** requireUser(["SUPER_ADMIN","DISTRICT_ADMIN"]) + an explicit role branch (the requireSuperAdmin
 *  pattern in unlock-admin.ts). React cache() per request. Assignments are NOT cached across
 *  requests, so a removed assignment takes effect on the next request. */
export async function requireAdminScope(): Promise<{ user: User; scope: AdminScope }>;

/** findFirst({ where: { id, ...schoolWhereForScope(scope), ...demo }, select }) or throw NOT_FOUND.
 *  The scope is IN the where, like `schoolId: user.schoolId` everywhere else. Load-then-assert is
 *  used only when a row arrives from another helper (findUnlockRecipient, a ticket). */
export async function loadSchoolInScope<S>(scope: AdminScope, schoolId: string, select: S): Promise<...>;
```

Rules every district-scoped call site follows:

1. The first line is `requireAdminScope()`. Never `requireUser("DISTRICT_ADMIN")` alone: that call lets `SUPER_ADMIN` through implicitly, and the Super Admin branch must be explicit.
2. Every school, learner, ticket, grant or teacher lookup puts `school: schoolWhereForScope(scope)` (or `schoolId = ANY(scopeSchoolIds)` in raw SQL) **in the where**. A payload-supplied `schoolId` is never trusted until `loadSchoolInScope` returns it.
3. An out-of-scope hit throws `resourceNotFound(..., { crossTenant: true })`. The user sees the same message as for a missing row. `/admin/errors` records it with severity `security`.
4. Cache keys for any scoped read include `scopeCacheKey(...)`. The where clause and the key are built from the same `AdminScope` value, and the two helpers are tested together.
5. Existing `requireUser("SUPER_ADMIN")` sites are **not** widened, except the ones in 3.5. A repository scan test pins that list (T14).

### 3.5 Per-feature reuse plan

Each reused action switches its guard from `requireUser("SUPER_ADMIN")` to `requireAdminScope()` and adds the scope to its lookup. For `SUPER_ADMIN` the scope is `division`, so their behaviour is unchanged. Legacy hand-rolled actions touched here move to the `action()` wrapper in the same slice. Its result shape `{ ok:false, error }` stays compatible with existing `toast.error(res.error)` callers.

| Capability | Reused function | Change | Stays Super Admin only |
|---|---|---|---|
| Activate/deactivate school | `setSchoolActive` (`school-management.ts`) | `requireAdminScope` + `loadSchoolInScope`; `revalidateDivisionSummary()` | none |
| Reset School Head sign-in | `regenerateSchoolHeadCredential` (`school.ts`), the school-keyed reset to School ID | `requireAdminScope` + `loadSchoolInScope`; audit `via: "district_portal"` when the actor is a district admin | `resetSchoolHeadPasswordToDefault`, `revealSchoolHeadPassword` (accounts console, cross-tenant by design) |
| Edit school info | **New** `updateSchoolAsAdmin` in `school-management.ts`. Its write body is extracted into one function, `applySchoolInfoUpdate(schoolId, fields, actor)`, which `updateSchoolInfo` (School Head) also calls, so the name-uniqueness check and the `SCHOOL_UPDATE` audit live in one place | District admin may edit `name` and `address` only. Super Admin may also edit `region`, `division` and `district`. The validator is picked by `scope.kind`. Audit carries `{ fields, districtFrom, districtTo }` | Editing `district` |
| School Head editing district | `updateSchoolInfo` | **Stops writing `district`** (and `division`/`region`). The field is dropped from `src/components/school-head/school-info-form.tsx`. See 3.7 and Q3 | n/a |
| Support ticket inbox | `listInboxTickets` (`src/lib/support/queries.ts`) | Takes `schoolWhere` (from the scope); key adds `scopeCacheKey` | none |
| Resolve / decline ticket | `resolveTicket`, `declineTicket` (`support.ts`) | `requireAdminScope`; ticket loaded with `school: schoolWhereForScope(scope)` in the where. The status change becomes conditional (`updateMany` where status is `OPEN` or `IN_PROGRESS`, and the count must be 1), because two groups of people can now answer the same ticket | `revokeUnlockGrant`, `grantUnlockDirect` (legacy duplicates in `support.ts`) |
| Unlock windows | `issueUnlock`, `revokeUnlock` (`unlock-admin.ts`) | Replace `requireSuperAdmin()` with `requireAdminScope()`. Teacher mode: `findUnlockRecipient`, then `assertSchoolInScope(scope, target.school)`. School mode: `loadSchoolInScope`. Revoke: load the grant with `school: schoolWhereForScope(scope)` before calling `revoke*Unlock`. `listActiveUnlocks()` and `listUnlockTargets()` (`src/lib/unlock/admin-queries.ts`) take `schoolWhere` | `setSubmissionLocking`, `setMonthlyReadingLevelUnlock`, `admin-term-windows.ts` (Q9) |
| Cross-school transfer | `transferLearnerCrossSchool` (`enrollment.ts`) | `requireAdminScope`; learner loaded with `school: schoolWhereForScope(scope)`; target via `loadSchoolInScope`. **Rule: both the source and the destination school must be in the caller's scope.** For Ferdinand (Alabel 1 + 2), Alabel 1 to Alabel 2 is allowed. Alabel to Glan is refused (NOT_FOUND on the out-of-scope side), and the page says "Transfers to or from schools outside your districts are handled by the division office." Super Admin is unchanged | none |
| Announcements | **New** `src/lib/actions/district-announcements.ts`: `broadcastAnnouncement({ title, body, target })`, where `target` is all, one district, or chosen `schoolIds[]`; and `retractBroadcast({ broadcastId })` | The target is resolved through `resolveScopeSchools`; any out-of-scope id makes the whole call NOT_FOUND. Fan-out is one `Announcement` row per school with a shared `broadcastId` (uuid) and `authorId` = actor, written with `createMany` in one transaction, then `revalidateSchoolDashboard(id)` for each school. Retract soft-deletes (`deletedAt`) rows where `broadcastId` matches and `school: schoolWhereForScope(scope)`. The School Head's `updateAnnouncement`/`deleteAnnouncement` refuse rows with `broadcastId != null`. Audit `ANNOUNCEMENT_BROADCAST` / `ANNOUNCEMENT_BROADCAST_RETRACT` with `{ broadcastId, schoolCount }` | none |
| Exports | **New** `exportSummary` in `src/lib/actions/summary-export.ts` | See 3.6 | none |
| Account recovery for district admins | the `resetTeacherPassword` pattern in `accounts.ts` | **New** `resetDistrictAdminPassword`: Super Admin only; readable random credential; `mustChangePassword: true`; `app_metadata: { role: "DISTRICT_ADMIN" }`; audit `DISTRICT_ADMIN_PASSWORD_RESET`. The shared body (`issueRandomPassword(target, role)`) is extracted so the teacher and district paths do not copy each other | the whole action |
| Global search | `globalSearch` (`global-search.ts`) | New explicit branch: `DISTRICT_ADMIN` gets schools matching the query within `schoolWhereForScope(scope)`, plus district pages. No learners, no teachers. Today's `if (!isAdmin && !user.schoolId) return []` stays as the fallback for any other school-less role | none |
| Admin profile edit | `updateAdminProfile` | `requireAdminScope()` (any scope may edit its own name) | none |

New `AUDIT_ACTIONS` (`src/lib/audit-actions.ts`): `DISTRICT_ADMIN_CREATE` and `DISTRICT_ASSIGNMENT_ADD` (both written by the script), `DISTRICT_ADMIN_PASSWORD_RESET`, `ANNOUNCEMENT_BROADCAST`, `ANNOUNCEMENT_BROADCAST_RETRACT`, `SUMMARY_EXPORT`. The reused actions keep their existing audit names and add `actorRole` to the metadata. Their rows carry the school's `schoolId`, so a district admin's changes show up in that school's own `/school-head/audit`.

**Where scoped schools come from, once.** `resolveScopeSchools(scope, demoVisible)` in `src/lib/summary/scope-schools.ts` returns `{ id, name, schoolIdCode, district, isActive }[]`, cached under `[schoolsList, divisionSummary]` with the key `scopeCacheKey`. Every district page, picker and summary query takes its school list from it. No page writes its own `prisma.school.findMany` for a district view.

### 3.6 Summary: one component set, one query set

**Facet registry.** `src/lib/summary/facets.ts` is the single list of summary facets. Pages, nav, export and tests all read from it: `learners` · `reading-behavior` · `end-of-term` · `attendance` · `reading-levels` · `compliance` · `profiling`. Each entry holds: `id`, `label`, the `params` validator (school-year label, term, month range), `load(summaryScope, params): Promise<FacetResult>`, and `toReportTable(result, frame)` for export.

**Query grain.** Each facet runs **one `$queryRaw` round trip** (a UNION ALL of per-field GROUP BYs over one CTE) that returns rows at the finest grain the facet needs, usually `(schoolId, gradeType, field, bucket, count)`. The CTE's population always starts from `l."schoolId" = ANY(${scopeSchoolIds}::text[])`, with the ids taken from `resolveScopeSchools`. There is no per-school loop and no N+1.

**Roll-up is pure.** `src/lib/summary/shape/rollup.ts`:

```ts
rollUp(rows: FacetRow[], schools: ScopeSchool[], level: "overall" | "district" | "school",
       opts: { byGrade: boolean }): SummaryTable
// SummaryTable = { groups: { key, label,
//   cells: Record<bucketId, { count: number; base: number; pct: number | null }> }[] }
```

One `pct(count, base)` helper decides rounding for everything: 1 decimal, and `null` when `base = 0`.

**One rule for percentages.** A cell's base is the size of that row's population: learners in that grade and scope, or completed profiles, or learners assessed in both months. Every single-choice facet carries a "Not answered" or "Not collected for this grade" bucket, so a row's percentages add up to 100. Multi-select facets (frustration subtypes, trainings, 4Ps) show "% of population", and the subtype table also shows "% of Frustration". Both are labelled as not adding up to 100.

**Population, defined once.** Move `ACTIVE_ENROLLED_LEARNER` out of `src/lib/dashboard/aggregates.ts` into `src/lib/learners/population.ts` and export it; `aggregates.ts` then imports it. Summary learner facets use that definition (a live learner with an ACTIVE enrollment in an active school year), so the division learner count equals the existing IP-metrics denominator. ARAL-only facets (reading behaviour, attendance, monthly reading level) narrow it further with `isAralLearner = true`.

**Demo exclusion.** For `division`, `resolveScopeSchools` applies `demoSchoolFilter(await isDemoVisible())`, exactly as `getAdminMetricCounts` does. For `districts`, `isDemo: false` is always part of `schoolWhereForScope`, and the account script refuses to assign `[demo district]`.

**Caching.** Each facet load is wrapped in `cachedQuery`:
- `keyParts: ["summary", facetId, "v1", scopeCacheKey(summaryScope, demoVisible), paramsKey]`
- `tags: [divisionSummary]`, plus `schoolDashboard(id)` for a school scope
- `profile: "reference"` (300 s TTL)

Add a `divisionSummary` tag to `src/lib/cache/tags.ts` and `revalidateDivisionSummary()` to `src/lib/cache/revalidate.ts`. `revalidateSchoolsList()` also expires `divisionSummary`, because adding, removing, activating or re-districting a school changes the school set of every summary. Attendance, reading and grade writes deliberately do **not** bust it: across 339 schools that would mean one flush per teacher click. The page prints "Figures as of HH:MM (refreshed every 5 minutes)".

**Components** (`src/components/summary/`):
- `SummaryScopeBar`: level tabs (Overall, By district, By school) plus district and school selects. The options come from the server and are already scoped.
- `SummaryFacetView`: a server component taking `{ facetId, adminScope, searchParams }`. It calls `resolveSummaryScope`, then `loadSchoolInScope` when a school is requested, then `facet.load`, and renders the result.
- `SummaryTable`: count and % cells, sticky first column.
- `SummaryExportMenu`: Excel (Print template or Records) and PDF, the same choice as the Reports hub.
- One panel per facet (`LearnersPanel`, `AttendancePanel`, ...), using Recharts where the School Head dashboard already charts the same thing.

Both route trees are thin wrappers:
- `src/app/admin/summary/page.tsx` (facet index) and `src/app/admin/summary/[facet]/page.tsx`
- `src/app/district/page.tsx` (overview) and `src/app/district/summary/[facet]/page.tsx`

Each page calls `requireAdminScope()` and renders `<SummaryFacetView .../>`. An unknown facet calls `notFound()`.

**Export.** `exportSummary(input)` is wrapped in `action()` and runs these steps:
1. `requireAdminScope`.
2. Validate with `summaryExportSchema` (`src/lib/validators/summary.schema.ts`).
3. Rate limit `summary-export:<userId>` at 20 per 10 minutes.
4. `resolveSummaryScope` / `loadSchoolInScope`.
5. `facet.load`.
6. `facet.toReportTable(result, frameForScope(...))`.
7. `renderReport(table, format, { purpose, generatedOn: schoolToday() })`.
8. Audit `SUMMARY_EXPORT` with `{ facet, level, scopeKind, districtCount, schoolCount, format, purpose }`. No names.
9. Return base64 and a filename.

It writes **no `Report` row**, because `Report.schoolId` is required and a district export has no single school.

`frameForScope` (`src/lib/summary/export.ts`) fills `ReportFrame`:
- `schoolName`: the scope label, e.g. "Alabel 1 and Alabel 2 districts (31 schools)". A school scope reuses `loadReportFrame` instead.
- `district`: the joined district names.
- `division` and `region`: the distinct values across the scope's schools.
- `schoolYearLabel`: the selected label.
- `schoolHeadName`: empty.
- `preparedBy`: the actor.

### 3.7 Write paths this design does not control

- **`School.district` becomes an authorization key, not a label.** Today a School Head who retypes it moves their school into another district admin's scope, or out of every scope. Recommendation:
  - School Heads stop editing it (3.5).
  - District admins cannot edit it.
  - Only the Super Admin edits it, through `updateSchoolAsAdmin`. The form offers the existing districts as a datalist and warns "Changing the district moves this school to another district admin." The audit records the old and new values.
- **`scripts/import-schools.ts`** creates schools and skips existing ones (`scripts/import-schools.ts:410-417`), so it never rewrites the district of a school a district admin supervises. A *new* school imported with a misspelled district is covered by no district admin. That fails closed rather than leaking. It shows up on the "Schools with no district admin" card on `/admin/summary/compliance`, which is a pure set difference: in-scope schools minus districts that have an assignment.
- **Casing drift.** Scope comparison is exact. Whitespace is canonical on both sides (`formatOptionalLabel` for schools, the M2 CHECK for assignments), so the only possible drift is letter case: "alabel 1" does not match "Alabel 1". That is intentional (fail closed), and the same card shows it.

---

## 4. Summary data: metric to field mapping

All counts use the population defined in 3.6. Every item is available overall, per district and per school. "Per grade" means `GradeLevel.type` of the learner's **current** `gradeLevelId`. Labels come from `src/lib/constants/enum-labels.ts`. Rows marked **GAP** have no backing field; no field is invented for them.

### 4.1 Learners (facet `learners`; population: active-enrolled learners)

| DOCX item | Backing field | Buckets / notes |
|---|---|---|
| Age | `Learner.age` (Int, NOT NULL) | One bucket per age in years. **Note:** this is the age entered when the learner was rostered. There is no birthdate, so it is never recomputed. |
| Gender M/F | `Learner.gender` (NOT NULL) | `GENDER_LABELS` |
| English reading profile per grade | `Learner.englishReadingProfile` (nullable) | The four bands via `readingProfileLabelsForGradeType(type)`. **Kinder** holds early-rubric values (`CANNOT_NAME_SOUND_LETTERS` … `CVC_BLENDING`) with no DOCX band; they are shown as four extra columns, not forced into a band. **G1/G2**: NULL by policy, shown as "Not collected for this grade" (`languagesForGrade`). **G11/G12**: Non-decoder is no longer offered, but legacy rows still count. |
| If frustration: Decoding / Comprehension (all) / Comprehension (critical only) | `Learner.englishFrustrationSubtypes` (enum array) | Counted only when the profile is `FRUSTRATION_HIGH_EMERGENT`. Multi-select: shown as % of the grade population and % of Frustration. `FRUSTRATION_SUBTYPE_LABELS` |
| Filipino reading profile per grade, with subtypes | `Learner.filipinoReadingProfile` (NOT NULL), `filipinoFrustrationSubtypes` | Same as English. Collected for every grade. |
| 4Ps per grade and overall | `Learner.governmentBenefits` contains `FOUR_PS` | Yes / No |
| Parents' educational background per grade and overall | `Learner.parentEducation` (NOT NULL) | The 7 `PARENT_EDUCATION_LABELS` buckets. **Note:** one value per learner; mother and father are not recorded separately. |
| Mode of transportation | `Learner.modeOfTransportation` (nullable) | Walking / Motorcycle / Bus-Jeep-Car / Not answered |
| Distance, home to school | `Learner.distanceHomeToSchool` (nullable) | Less than 1 km / 1–5 km / More than 5 km / Not answered |
| Previous school transfers | `Learner.previousTransfers` (nullable) | None / 1 / Multiple / Not answered. **Partial GAP:** the "Specify" text (`transferDetails`) is free text and is not summarized. |

### 4.2 Reading behaviour, as of July, SY 2026-2027 (facet `reading-behavior`; population: ARAL learners)

| DOCX item | Backing field | Notes |
|---|---|---|
| Word recognition level 0–5, N/A | `ReadingLevelRecord.wordRecognitionLevel` (`WeeklyWordRecognitionLevel`) | The month is a parameter. It defaults to July of the selected school year (`weekStart` from 2026-07-01 up to, not including, 2026-08-01). One record per learner per month: the latest `weekStart` in that month (`DISTINCT ON`), because legacy weekly rows can share a month (see `reading-level-progress.ts`). The labels already match the DOCX text word for word. Adds a "No record this month" bucket. |
| Reading comprehension level 6–8, 0, N/A | `ReadingLevelRecord.readingComprehensionLevel` | The DOCX's Levels 6, 7 and 8 are the app's `LEVEL_1`, `LEVEL_2` and `LEVEL_3` (literal, inferential, critical). Only the numbering differs from the app label "Level 1: Can comprehend literally"; see Q6. |
| (not used) | `AralProfile.wordRecognition` | This is a different question, from the Section C survey. `docs/aral-profile.md` keeps it off every workflow, so the summary does not read it. |
| **GAP** | none | Word recognition and comprehension are only recorded for ARAL learners, so non-ARAL learners have no data. The DOCX does not limit these items to ARAL learners. The facet subtitle says so. |

### 4.3 End of term (facet `end-of-term`; params: school-year label, term)

| DOCX item | Backing field | Notes |
|---|---|---|
| Average per subject | `TermGrade.score` (60–100, SQL CHECK) joined to `TermSubject` | School year filter: `SchoolYear.label = :label`. Each school has its own `SchoolYear` rows, so the label is the key shared across schools. **Subject key** (pure `subjectKey()`): `TermSubject.legacyArea` when set, otherwise `lower(btrim(TermSubject.name))`. Legacy rows with `termSubjectId IS NULL` use `TermGrade.subject`. Archived subjects (`TermSubject.deletedAt`) are excluded, as on the grade sheets. The display name is the `LEARNING_AREA_LABELS` label, or the most common spelling. |
| No. and % of learners with 80+ per subject | `TermGrade.score >= 80` | Base = learners with a score in that subject and term. |
| **GAP: Grade 1** | `TermGrade.mark` (A–E letter) | Grade 1 has no numeric score, so it has no average and no 80+ count. The facet shows the Grade 1 letter-mark distribution instead (Q7). |
| **N/A: Kindergarten** | `KinderCompetencyRecord` | A competency checklist, not subjects. Excluded, with a note on the page. |
| Note | `TermGrade` has no `schoolId` | Grades count toward the learner's **current** school. A learner transferred mid-year carries their earlier grades to the new school. |

### 4.4 Weekly attendance (facet `attendance`; population: ARAL learners; params: month range)

| DOCX item | Backing field | Notes |
|---|---|---|
| Attendance rate per week | `Attendance.status`, `Attendance.weekStart`; holidays from `AttendanceDayMeta.isHoliday` per grade | Uses **the existing definition**, moved into one pure function: `attendanceRatePct({ presentMarks, learnerCount, schoolDays })` in `src/lib/attendance/week-stats.ts`, which `computeWeekStats` is refactored to call. Present means `PRESENT` only (Q5). `schoolDays` = Monday to Friday minus that grade's holidays. `learnerCount` = the grade's current ARAL learners. The SQL returns `(schoolId, gradeLevelId, weekStart, presentMarks)` and `(gradeLevelId, weekStart, holidayCount)`. |
| Attendance rate per month | same | Total present ÷ total possible, over the weeks whose Monday falls in the month. |
| Schools with 0% attendance | same, per school | Two lists: "No attendance recorded" (has ARAL learners, no rows in the period) and "Recorded, 0% present". Schools with no ARAL learners are listed as "No ARAL learners", not as 0%. |
| **GAP** | none | Attendance for non-ARAL learners is not recorded anywhere in the app. |

### 4.5 Monthly reading level (facet `reading-levels`; population: ARAL learners; params: month range)

| DOCX item | Backing field | Notes |
|---|---|---|
| Count and % per level per month per grade | `ReadingLevelRecord.englishProfile`, `.filipinoProfile` | Shown per language. One record per learner per month (the latest `weekStart`). Each grade's scale comes from `readingProfileOptionsForGrade(type)`. |
| Improved (moved level) per grade | same fields, consecutive months | Pure `classifyReadingMovement(prev, curr, gradeType)` returns `improved`, `same`, `declined` or `not_comparable`. A level's rank is its index in `readingProfileOptionsForGrade`. A value that is not on the grade's scale (for example a promoted learner's old Kinder rubric value) is `not_comparable`. Base = learners with a record in **both** month M-1 and month M for that language. |
| No improvement per grade | same | Counts `same`. `declined` is reported on its own, never folded into "no improvement" (Q4). |

### 4.6 Non-compliance (facet `compliance`; overall and per district, listing the schools; active schools only)

A pure `classifyCompliance(facts: SchoolComplianceFacts, todayKey: string): ComplianceFlags` holds every definition below. One SQL round trip gathers the facts for all schools in scope.

| Flag | Definition as implemented | Backing fields |
|---|---|---|
| No encoded data | The school has 0 live learners (`deletedAt IS NULL`). | `Learner` |
| Pending | At least one live teacher with `approvalStatus = PENDING`, **or** at least one live, non-FLOATING `GradeLevel` where no live `Section` has an `adviserId` pointing at an active, live teacher. | `User.approvalStatus`; `GradeLevel`; `Section.adviserId` (same rule as `src/lib/teachers/adviserless.ts`) |
| Not updated | The school has ARAL learners, **and** either no `Attendance.date` in the last 14 local days (`formatLocalDateKey`) **or** no `ReadingLevelRecord` with `weekStart` in the current month. | `Attendance`, `ReadingLevelRecord` |
| Incomplete | At least one active-enrolled learner with `nutritionalStatus IS NULL`, **or** with `englishReadingProfile IS NULL` in a grade where `languagesForGrade` includes English. These are the only fields Zod requires that the database allows to be NULL. Ethnicity and Section B are optional by design, so they do not count. | `Learner` |
| Discrepancies | Any one of: live non-archived learner count ≠ active-enrollment count; a learner whose `gradeLevelId` ≠ the `gradeLevelId` of its ACTIVE `Enrollment` (pointer drift, a CLAUDE.md invariant); the school recorded attendance in the last full week but the number of distinct learners marked ≠ its ARAL roster; the same test for this month's reading records. | `Learner`, `Enrollment`, `Attendance`, `ReadingLevelRecord` |

"Discrepancies" and "Not updated" are my reading of one-line DOCX items. Tests pin them so they cannot drift silently, and Q8 asks the operator to confirm them.

### 4.7 Teacher and School Head profiling (facet `profiling`; base: completed profiles; the page also shows accounts with no profile)

Population: live, active, `APPROVED` teachers, and live, active School Heads, in scope. Name, contact number and email are **not** summarized (PII).

| DOCX item | Teacher field | School Head field | Notes |
|---|---|---|---|
| Designation | `TeacherProfile.designation` (String?) | `SchoolHeadProfile.designation` | Pure `bucketDesignation` sorts answers into: Teacher / Master Teacher / School Head / Non-DepEd ARAL Volunteer (`ARAL_VOLUNTEER_DESIGNATION`) / Others. Custom "Others" text is not listed. |
| Position | `TeacherProfile.position` (`TeacherPosition?`; NULL for volunteers and Others, shown as "Not applicable") | `SchoolHeadProfile.position` (`SchoolHeadPosition`) | `TEACHER_POSITION_LABELS`, `SCHOOL_HEAD_POSITION_LABELS` |
| Highest educational attainment | `educationalAttainment` | `educationalAttainment` | `EDUCATIONAL_ATTAINMENT_LABELS` |
| Field of specialization | `fieldOfSpecialization` | `fieldOfSpecialization` | The `specializationOther` free text is not summarized. |
| Years in service | `yearsInService` (Int?; NULL means N/A) | `yearsInService` (Int) | Pure `bucketYearsInService`: 0–3 / 4–10 / 11–20 / 21+ / N/A, the DOCX bands. |
| Current grade level assignment | `TeacherProfile.currentGradeAssignment` (`GradeLevelType?`) | N/A | **Note:** this is the teacher's own profile answer. The live assignment is `Section.adviserId`. The facet reports the profile answer, because that is what the DOCX asks for. |
| Most subject handled | `TeacherProfile.mostSubjectHandled` (`Subject?`) | N/A | **GAP:** the question was removed from the profiling form, so only old profiles have an answer. Shown with a "No longer asked" note. |
| Literacy / reading trainings (Yes/No, and which) | `hasReadingTraining`, `readingTrainings[]` | same | Multi-select. `READING_TRAINING_LABELS` |
| English curriculum trainings (Yes/No, and which) | `hasEnglishTraining`, `englishTrainings[]` | same | Multi-select. `ENGLISH_TRAINING_LABELS` |
| Highest training level | `highestTrainingLevel` | same | `TRAINING_LEVEL_LABELS` |

### 4.8 Query cost

339 schools; one SQL round trip per facet; grouping happens in Postgres. Existing indexes cover every join: `Learner(schoolId, …)`, `Enrollment(learnerId, status)`, `Attendance(date)` and `(learnerId, weekStart)`, `ReadingLevelRecord(weekStart)`, `TermGrade(schoolYearId, term)` and `(termSubjectId)`. **No new index in v1.** Before release, run a read-only `EXPLAIN (ANALYZE, BUFFERS)` of each facet's division-scope query on production-sized data. If an index turns out to be needed, it is additive and goes through `prisma/concurrent-indexes.sql`. At division scope the `learners` facet returns at most about 100k fine-grained rows before roll-up. Caching each facet in its own entry keeps every KV value well under the Workers KV size limit.

---

## 5. Everything that switches on role (exhaustive list to touch)

Adding the enum value breaks every `Record<UserRole, …>` map at compile time, which is the point. The 44 files that branch on `role === "SUPER_ADMIN"` do **not** break at compile time, so each was checked by hand. Every site not listed below stays as it is, because it sits behind `requireUser(<roles without DISTRICT_ADMIN>)` or `requireSchoolUser` and a district admin never reaches it.

| Site | Change |
|---|---|
| `src/lib/constants/enum-labels.ts` `USER_ROLE_LABELS` | Add `DISTRICT_ADMIN: "District admin"` |
| `src/lib/auth/roles.ts` | See 3.3 |
| `src/lib/nav/nav-config.ts` `getNavGroups` | New `DISTRICT_ADMIN` case: Overview (`/district`), Summary (one item per facet, read from the registry), Schools, Support, Announcements, Transfers, Unlocks. `SUPER_ADMIN` gains "Division Summary" (`/admin/summary`). |
| `src/lib/nav/warm-hrefs.ts`, `src/lib/nav/not-found-links.ts` | Add a `DISTRICT_ADMIN` case |
| `src/components/shell/app-header.tsx` `SEARCH_HREF`, `SEARCH_PLACEHOLDER` | `/district/schools` and "Search your schools and pages…" |
| `src/lib/releases.ts` `ReleaseAudience` | Add `"DISTRICT_ADMIN"`. Entries with no `roles` already reach everyone. |
| `src/lib/notifications.ts` actor label | `DISTRICT_ADMIN` → "District admin", so a teacher whose ticket was answered sees who answered it |
| `src/components/role-shell.tsx`, `src/components/assistant/assistant-panel.tsx` | Do not mount the assistant for `DISTRICT_ADMIN`: `askAssistant` answers NO_SCHOOL, and `submitTicket` needs a school. `canEscalate` treats `DISTRICT_ADMIN` like `SUPER_ADMIN`. |
| `src/app/district/layout.tsx` (new) | `requireAdminScope()`, then `RoleShell`. The bell uses `getDistrictNotifications(user, scope)`: a **derived** "N open support tickets in your districts" count (cached under `supportInbox` with `scopeCacheKey`), plus the release alert. **No** new `Notification` rows (13.F). |
| `src/lib/actions/accounts.ts` `impersonateUser` | Replace the `role === "SUPER_ADMIN"` refusal with an allow-list (`TEACHER`, `SCHOOL_HEAD`, `DISTRICT_ADMIN`) and redirect by `roleHomePath(target.role)`, so a `DISTRICT_ADMIN` target lands on `/district` (amended 2026-09-25, see I14). |
| `src/lib/admin/accounts.ts` (`accountSignIn`, `accountPasswordState`, summary counts) | `DISTRICT_ADMIN` rows show the username and a `never_stored` password; add `districtAdminCount`. |
| `src/components/admin/account-row-actions.tsx` | `DISTRICT_ADMIN` rows: "Sign in as" (lands on `/district`, see I14); "Issue password" calls `resetDistrictAdminPassword`; show the assigned districts. |
| `src/lib/help/search.ts`, `src/lib/assistant/prompt.ts` | No help topics for `DISTRICT_ADMIN` in v1. Confirm the role falls through to none. |
| `src/lib/chat/*`, `src/lib/actions/chat.ts` | No change. A test confirms a school-less non-admin gets empty or forbidden results (T12). |
| `src/app/admin/layout.tsx` | Unchanged. Because of `role !== "SUPER_ADMIN"`, it renders children with no shell, so `/admin/login` still renders for a signed-out district admin, and middleware already redirects a signed-in one. |

---

## 6. Invariants and where each is enforced

| # | Invariant | Enforced by |
|---|---|---|
| I1 | Assignment rows grant scope only to users whose role is `DISTRICT_ADMIN` | Pure `adminScopeFor(role, …)` + T1. **A CHECK cannot express this:** the role lives on `User` and the rows live in another table. So it is enforced in application code, pinned by a test, by choice. |
| I2 | An assignment's district is canonical (trimmed, single-spaced, non-empty) | DB CHECK `DistrictAdminAssignment_district_canonical` (M2) |
| I3 | One row per (admin, district) | DB composite primary key |
| I4 | An assigned district names a real, non-demo district | The script's `planDistrictAdmins` checks it against `DISTINCT School.district WHERE isDemo = false AND deletedAt IS NULL` and aborts the whole run on an unknown name. **Not a foreign key**, because `School.district` is free text (13.A). Drift after that is reported on the "no district admin" / "assigned district with no schools" card. |
| I5 | A district admin has 1–3 districts | Script validation. Not safety-critical: an admin with zero assignments sees nothing. |
| I6 | Every district-scoped read and write touches only in-scope schools | `schoolWhereForScope` in the Prisma where, or `ANY(scopeSchoolIds)` in raw SQL; per-action tests T3–T9 |
| I7 | An out-of-scope school looks exactly like one that does not exist | `assertSchoolInScope` / `loadSchoolInScope` throw `resourceNotFound(..., { crossTenant: true })` + T2 |
| I8 | A Super Admin sees the whole division through an explicit branch, never through `allowSuperAdmin` | `requireAdminScope` + T1 |
| I9 | A cached scoped result is never served to a different scope | `scopeCacheKey` in every summary `keyParts` + T10 |
| I10 | The demo tenant is excluded | `schoolWhereForScope` (districts always add `isDemo: false`), `demoSchoolFilter` on the division scope, and the script's refusal + T11 |
| I11 | Only a Super Admin changes a school's district | `updateSchoolInfo` no longer writes it; the `updateSchoolAsAdmin` validator is chosen by `scope.kind` + T6 |
| I12 | A cross-school transfer by a district admin has both schools in scope | `transferLearnerCrossSchool` + T7 |
| I13 | School Heads cannot edit or delete a broadcast | `updateAnnouncement` / `deleteAnnouncement` refuse `broadcastId != null` + T8 |
| I14 | District admins cannot impersonate anyone. A Super Admin may sign in as a district admin (User Accounts "Sign in as", Test Lab "Open as District Admin"); the session lands on `/district` and `requireAdminScope` yields that district admin's districts, never the division. Super Admins can never be impersonated. Writes made in that session are real (same as impersonating a School Head or teacher) and recorded against the district admin's account. During a verified impersonation (signed ticket bound to the live session, naming the account) of any role, `requireUser` skips the `/account/set-password` redirect and `skipPasswordChange` never clears `mustChangePassword`; that prompt stays for the real person | `impersonateUser` target allow-list (`TEACHER`, `SCHOOL_HEAD`, `DISTRICT_ADMIN`) plus `startImpersonation`'s SUPER_ADMIN refusal, and `requireUser("SUPER_ADMIN")` on the caller + T13; `tests/unit/auth/impersonated-district-scope.test.ts`; banner via `ImpersonationNotice` in `src/app/district/layout.tsx` |
| I15 | `DISTRICT_ADMIN` appears in role lists only in the approved modules | Repository scan test T14 |
| I16 | The first sign-in forces a new password | `mustChangePassword = true` (set by the script) + `skipPasswordChange` refusal + T15 |
| I17 | Division total = sum of district rows = sum of school rows, for single-choice facets | Pure `rollUp` + T16 |
| I18 | Existing `Announcement` rows keep their meaning | M3 adds NULL = "school-authored", which describes every existing row |

---

## 7. Account script: `scripts/create-district-admins.ts`

Follows `scripts/seed-division-admins.ts` and `scripts/create-e2e-admin.ts`: env comes through `scripts/lib/script-db.ts`, auth users through `createSupabaseAdminClient`. Reusing a half-created auth user copies `scripts/import-schools.ts`.

```
npx tsx scripts/create-district-admins.ts            # dry run (default)
npx tsx scripts/create-district-admins.ts --commit   # write
```

**Roster.** A typed constant in the script: 14 entries of `{ username, firstName, lastName, districts[] }`. Usernames are lower-case `first.last`:
`ferdinand.simon`, `glenda.elem`, `noli.cabaylo`, `fernie.cabanalan`, `pacita.ramos` (spelled "PAcita" in the DOCX), `teresita.macabacyao`, `glenn.castillas`, `susana.sumagka`, `felix.barrenan`, `pinky.tanap`, `roy.tribunalo`, `taya.saling`, `argelio.arago`, `eriel.napila`.
Districts are copied exactly from the operator brief.

**Pure planner.** `planDistrictAdmins(roster, existingUsers, knownDistricts)` lives in `scripts/lib/district-admin-plan.ts`. It returns `{ create[], skip[], addAssignments[], extraAssignments[], conflicts[], unknownDistricts[], badCounts[] }` and is unit tested (T17), the same way the `import-schools` argument parsing is.

**Flow**

1. `loadEnvFile()`, then print the **database host** and the **Supabase host**, as `create-e2e-admin.ts` does. Production's database is the Hyperdrive origin, not the one in `.env.local` (project memory), so the operator must check both hosts before running `--commit`.
2. Stop with "apply migrations first" if the `UserRole` enum has no `DISTRICT_ADMIN` value, i.e. M1 is not applied (checked with a `pg_enum` query).
3. `knownDistricts` = the distinct non-null `School.district` values where `deletedAt IS NULL AND isDemo = false`. If any roster district is not in that list, print the list and **exit 1 before writing anything**. Also exit 1 if any admin has fewer than 1 or more than 3 districts.
4. Look for existing rows by `username` or `email`:
   - Same role (`DISTRICT_ADMIN`): skip creation, but still plan any missing assignments.
   - Any other role: **conflict**, exit 1. An existing account is never repurposed.
5. The dry run prints a table: username, action (create / exists / conflict), districts, assignments to add. Extra assignments already on an existing admin are **reported, never deleted** (Q14).
6. With `--commit`, for each account:
   - Password comes from a new pure function, `generateReadableCredential()` in `src/lib/auth/credentials.ts`: 16 characters from an unambiguous alphabet, grouped `xxxx-xxxx-xxxx-xxxx`, always containing a letter and a digit so it passes `isStrongPasswordShape`.
   - If a previous run died between the Supabase write and the database write, an auth user with this email already exists. Reuse it (scan with `listUsers`, as `import-schools.ts` does) and set the new password with `updateUserById`.
   - Otherwise create the auth user: `auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: "DISTRICT_ADMIN" }, user_metadata: { role: "DISTRICT_ADMIN" } })`.
   - In one `prisma.$transaction`: `user.create` (fields as in 3.1), then `districtAdminAssignment.createMany({ skipDuplicates: true })`.
   - Write one `AuditLog` row `DISTRICT_ADMIN_CREATE` with `{ username, districts }`, never the password. The script writes it with `prisma.auditLog.create`, because `writeAudit` needs a request scope.
   - Existing admins get only their missing assignments, each audited as `DISTRICT_ASSIGNMENT_ADD`.
7. **Credentials CSV, written once.**
   - Path: `.credentials/district-admins-<YYYYMMDD-HHmmss>.csv`. Add `.credentials/` to `.gitignore` in the same change.
   - Before writing, run `git check-ignore -q <path>`. If the path is not ignored, abort without writing the passwords anywhere.
   - Open the file with flag `wx`, so an existing file is never overwritten.
   - Columns: `name,username,password,districts,login_url`, where `login_url` is `<origin>/admin/login` (origin from `NEXT_PUBLIC_APP_URL` when set).
   - Only accounts created in this run are listed. Passwords are not stored anywhere else, so a later run cannot print them again.
   - The console shows usernames and the file path, never passwords.
8. Final message: "Hand each person their row, then delete the file. Lost passwords: Super Admin → User Accounts → Issue password."

Idempotent: after a full success, a re-run prints "exists" for all 14 and writes nothing. After a partial failure, a re-run creates only what is missing.

---

## 8. Test plan

Every scope test is written to fail if the scope check it guards is removed. Tests mock `@/lib/prisma` and spy on the `where` argument, the house style used in `tests/unit/actions/unlock-admin.test.ts`.

| ID | File | Assertions (each fails if the scope check is removed) |
|---|---|---|
| T1 | `tests/unit/auth/admin-scope.test.ts` | `adminScopeFor`: SA gives division; DA gives sorted districts; TEACHER and SCHOOL_HEAD give null; DA with no rows gives empty districts. `schoolWhereForScope(districts)` contains `district.in` and `isDemo:false`; division has no district key. `requireAdminScope` with a mocked session: SCHOOL_HEAD gets AUTH_FORBIDDEN, and assignments are never read for a non-DA. |
| T2 | same | `assertSchoolInScope`: other district, `district: null`, or a demo school (for a DA) each give NOT_FOUND with `crossTenant`. `resolveSummaryScope({district:"Glan 1"})` for an Alabel admin gives NOT_FOUND. |
| T3 | `tests/unit/actions/district-school-management.test.ts` | `setSchoolActive`, `regenerateSchoolHeadCredential`, `updateSchoolAsAdmin` as DA on an out-of-scope id: `school.findFirst` gets the district filter in `where`, the result is NOT_FOUND, **and no update, Supabase or audit call happens**. |
| T4 | `tests/unit/actions/support-ticket.test.ts` (extend) | Resolve and decline by a DA: the ticket lookup's `where.school` carries the scope. An out-of-scope ticket gives NOT_FOUND. When two answers race, the second gets "already answered". |
| T5 | `tests/unit/actions/unlock-admin.test.ts` (extend) | Teacher mode with the target in another district gives NOT_FOUND and no grant row. School mode, same. Revoking an out-of-scope grant gives NOT_FOUND. The existing SCHOOL_HEAD refusal test still passes. |
| T6 | `tests/unit/actions/school-info-district-lock.test.ts` | `updateSchoolInfo` (SH) with `district` in the FormData: `school.update` data has no `district` key. `updateSchoolAsAdmin` as DA with `district`: refused. As SA: written, and audited with the old and new district. |
| T7 | `tests/unit/actions/enrollment-transfer-scope.test.ts` | DA with the source out of scope gives NOT_FOUND; with the target out of scope gives NOT_FOUND; with both in scope, one transaction runs. SA behaviour is unchanged. |
| T8 | `tests/unit/actions/district-announcements.test.ts` | A broadcast that names an out-of-scope school gives NOT_FOUND and no `createMany`. Retract's `where` carries the scope. SH `updateAnnouncement` and `deleteAnnouncement` on a broadcast row give NOT_FOUND. |
| T9 | `tests/unit/actions/summary-export.test.ts` | A DA export with `?district=` outside the assignment gives NOT_FOUND before any query runs. The facet loader receives only in-scope school ids. The audit metadata holds no names. |
| T10 | `tests/unit/summary/scope-cache-key.test.ts` | Different district sets give different keys. The same set in another order gives the same key. Division with demo on and off gives different keys. A school scope keys on the school id. A spy on `cachedQuery` asserts that `keyParts` contains `scopeCacheKey(...)` for every facet; the test iterates `facets.ts`, so a new facet is covered automatically. |
| T11 | `tests/unit/summary/scope-schools.test.ts` | For a DA, `resolveScopeSchools` never returns `isDemo` schools, even in a demo session. For the division, it follows `demoSchoolFilter`. |
| T12 | `tests/unit/auth/district-admin-surfaces.test.ts` | A DA calling `globalSearch` gets only in-scope schools, and **no** learner or teacher query runs. `askAssistant` answers NO_SCHOOL. Chat reads return empty or forbidden. `requireUser("SCHOOL_HEAD")` and `requireSchoolUser` as a DA redirect to `/district`. |
| T13 | `tests/unit/actions/accounts.test.ts` (extend) | `impersonateUser` with a DA target, called by a Super Admin, signs in and lands on `/district` (amended 2026-09-25, I14); a SUPER_ADMIN target gives NOT_FOUND; a non-Super-Admin caller is refused before any lookup. `resetDistrictAdminPassword` as a DA is forbidden. As an SA it sets `mustChangePassword: true`, and the audit metadata does not contain the credential. |
| T14 | `tests/unit/district-admin-role-surface.test.ts` | Scans `src/**` for `requireUser(` and `requireSchoolUser(` argument lists that contain `"DISTRICT_ADMIN"`. The set of files must equal an allow-list: `district-scope.ts` only, since everything else goes through `requireAdminScope`. A second scan checks every `requireAdminScope()` call site against an allow-list. Widening access then needs a test edit that a reviewer will see. |
| T15 | `tests/unit/auth-helpers.test.ts`, `tests/unit/actions/admin-login.test.ts` (extend) | `enforceRolePrefix`: a DA on `/admin/x`, `/school-head` or `/teacher` goes to `/district`; a TEACHER on `/district` goes to `/teacher`; an SA on `/district` is allowed; `/districtfoo` does not match. `parseAppMetadataRole("DISTRICT_ADMIN")` is accepted. `loginAdmin` with a DA username redirects to `/district`; a TEACHER that has a username is denied. `skipPasswordChange` as a DA gives AUTH_FORBIDDEN. `requireUser(["DISTRICT_ADMIN"])` while signed out goes to `/admin/login`. |
| T16 | `tests/unit/summary/{rollup,compliance,reading-movement,attendance-rate,profiling-buckets,subject-key}.test.ts` | `rollUp`: single-choice rows sum to 100%, and district rows sum to the overall row. `classifyCompliance`: one case per definition in 4.6. `classifyReadingMovement`: improved, same, declined, not_comparable (including the Kinder-to-G1 scale change). `attendanceRatePct`: `computeWeekStats` returns the same `ratePct` before and after the refactor, using the fixtures in `tests/unit/attendance-week-stats.test.ts`. `bucketYearsInService`: boundaries 3/4, 10/11, 20/21, and null. |
| T17 | `tests/unit/import/district-admin-plan.test.ts` | An unknown district lands in `unknownDistricts` and nothing is created. `[demo district]` counts as unknown. An existing DA is skipped and gets only the missing assignments. A username held by a TEACHER is a conflict. 0 or 4 districts land in `badCounts`. |
| T18 | `tests/unit/role-exhaustiveness.test.ts` | Runs every `UserRole` value through `roleHomePath`, `notFoundLinksFor`, `getShellWarmHrefs`, `getNavGroups` and `USER_ROLE_LABELS`. None may return undefined, an empty result, or the fallback. |
| auto | `rls-coverage.test.ts`, `db/schema-order.test.ts`, `releases.test.ts` | Fail until the RLS line, the `SNAPSHOT_MODELS` entry and the version bump are in place. |
| E2E | `e2e/district-admin.spec.ts` (opt-in, against a local dev server) | A DA signs in at `/admin/login`, is forced through set-password, and lands on `/district`. The schools list shows only their districts. `/admin` and `/school-head` redirect to `/district`. `/district/schools/<out-of-scope id>` shows the 404 page. Needs a DA account created with the script against a local database. |

`src/lib/db/schema-order.ts`: add `{ model: "DistrictAdminAssignment", delegate: "districtAdminAssignment", operational: false }` directly after `User`. It has an FK to User, is not school-scoped, and is structural, so "clear operational data" keeps it.

---

## 9. Routes and pages

| Route | Guard | Content |
|---|---|---|
| `/admin/login` | public | The existing form, with the copy change from 3.3 |
| `/district` | `requireAdminScope` | Overview: assigned districts, school count, headline figures (learners, ARAL learners, this month's attendance rate, schools flagged for non-compliance), each linking to its facet |
| `/district/summary/[facet]` | same | `SummaryFacetView` at three levels: all my districts, one district, one school |
| `/district/schools` | same | Table of in-scope schools. Reuses `src/components/schools-table.tsx` with a new `capabilities` prop: toggle active, reset head, edit. **No** delete, no create |
| `/district/schools/[schoolId]` | same, plus `loadSchoolInScope`, which calls `notFound()` when out of scope | School details form (`updateSchoolAsAdmin`), head reset, active toggle, links to this school's summary facets |
| `/district/support` | same | Only the Tickets tab of `AdminSupportHub` (no chat, no email), reading the scoped inbox |
| `/district/announcements` | same | Compose (target: all my districts, one district, or chosen schools) and a list of my broadcasts with a retract button |
| `/district/transfers` | same | `CrossSchoolTransferForm`, fed with scoped school lists |
| `/district/unlocks` | same | The unlock half of the submissions console (`issueUnlock`/`revokeUnlock`, scoped targets, active grants). No global switches, no term windows |
| `/district/settings`, `/district/settings/profile`, `/district/settings/security` | same | Profile name (`updateAdminProfile`) and change password |
| `/admin/summary`, `/admin/summary/[facet]` | `requireAdminScope` (a Super Admin gets the division) | The same `SummaryFacetView` at overall, by-district and by-school levels, plus a "No district" group for schools whose district is NULL |

Each new segment gets a `loading.tsx`. `/district` also gets `error.tsx` and `not-found.tsx`, following `src/app/admin/*`. Every page is `force-dynamic`.

---

## 10. Migration and rollout path

1. **database-engineer** writes M1–M3 and checks them offline: `prisma validate`, `prisma format`, `prisma generate`, and `migrate diff` with file inputs. Then, per CLAUDE.md:
   - Confirm which database `DATABASE_URL` and `DIRECT_URL` point at. Production is the Hyperdrive origin.
   - Run `prisma migrate status` and read the **whole** pending list. If it holds anything besides M1–M3 that is not additive, stop and ask.
   - Run `prisma migrate deploy`.

   All three migrations are additive. No existing row changes meaning, there is no backfill, and every existing `Announcement` row's NULL `broadcastId` correctly reads as school-authored.
2. Merge the code in one push to main, with a release entry. This is a feature, so it takes a **minor** bump over whatever main holds; from today's 2.12.1 that is 2.13.0. `announce: true`. Write the fixes for users, with role-targeted lines:
   - Super Admin: "Division Summary shows learners, reading, attendance, grades, compliance and profiling for all schools, by district and by school".
   - School Head: "The district is now set by the division office".
   - District admin: a welcome line.
3. Straight after deploy no district admin exists yet. The visible changes are the Super Admin's Division Summary and the missing district field on the School Head's school form.
   - A School Head form loaded before the deploy that still posts `district` has it ignored; the stored value stays.
   - Admin pages calling the reused actions keep working: the result shape is unchanged and a Super Admin's scope is the division.
4. The operator runs `create-district-admins.ts` as a dry run against **production** (it prints both hosts), then with `--commit`. They hand out the CSV rows, then delete the file.
5. Each district admin signs in at `/admin/login`, is forced to `/account/set-password`, and lands on `/district`.
6. Update docs in the same push:
   - `docs/runbook.md`: resetting a district admin's password from User Accounts, and adding an assignment by re-running the script.
   - `docs/backlog.md`: a status line.

Rollback: revert the code push. The migrations are additive and can stay. District admin rows then hold an enum value the old code never reads, and `loginAdmin` filters on `SUPER_ADMIN`, so they cannot sign in.

---

## 11. Open questions for the operator

Each question has a default, and that default ships if nobody answers. Every default is coded at one decision point, so changing it later is a one-place edit.

- **Q1 Transfer approval.** The app has no transfer *request*: an admin performs the move directly. This design lets a district admin perform transfers between their own schools. Do you want School Heads to *request* transfers and admins to *approve* them? That needs a new `TransferRequest` table and a second slice.
- **Q2 Cross-district transfers** (for example Alabel 1 to Glan 2) go to the division office (Super Admin) only. Please confirm.
- **Q3 School Heads lose the ability to edit their school's district** (and region and division), because the district now decides who supervises the school. Please confirm. The alternative keeps the field, and accepts that a typo by a head silently takes the school out of district oversight.
- **Q4 "Improved"** means a higher level than the learner's previous month, in the same language. "No improvement" means the same level. Declines are shown separately. Please confirm, including whether a decline should count as "moved".
- **Q5 Attendance rate** counts `PRESENT` only, so `LATE` counts as not present. That is the rule on every teacher and School Head card today. Should LATE count as attended? Changing it changes those cards too, because they share the formula.
- **Q6 Reading comprehension** is labelled "Level 1–3" in the app and "Level 6–8" in the DOCX. Should the app switch to 6–8? It is a label change in `enum-labels.ts` only, but teachers would see it too.
- **Q7 Grade 1 end-of-term** grades are letter marks (A–E), not numbers. Is a letter-mark distribution acceptable in place of an average?
- **Q8 Non-compliance definitions** in 4.6. In particular, "Not updated" skips schools with no ARAL learners, and "Discrepancies" has four parts. Please confirm or restate them.
- **Q9 Term windows.** Should district admins also move term deadlines (`admin-term-windows.ts`), or only issue unlocks? Default: unlocks only.
- **Q10 Announcements** currently appear only on School Head pages. Should district broadcasts also reach teachers? That needs a new reader on teacher pages.
- **Q11 Names.** Please confirm "Glenda Elem" (is Elem the surname?), "Pacita Ramos" (the DOCX spells it "PAcita"), and the `first.last` username format.
- **Q12 Revealing a School Head's sealed password.** Default: district admins cannot. They can only reset it to the School ID.
- **Q13 Where sign-out lands.** Admins land on `/login`, the school sign-in page, today. Should both admin roles land on `/admin/login` instead?
- **Q14 Changing assignments later.** In v1 assignments are set by the script and can only be added. Removing a district from an admin needs either a Super Admin screen on User Accounts or a `--prune` flag on the script. Which do you prefer?
- **Q15 End-of-term defaults.** The summary would open on the school-year label most schools have active, and the latest closed term. Is that the right default?

---

## 12. Task breakdown by owner

No two tasks in the same wave touch the same file. Directories that CLAUDE.md's ownership list does not name are assigned here:
- backend: `src/lib/summary/**`, `src/lib/learners/population.ts`, `src/lib/attendance/**`, `src/lib/support/**`, `src/lib/unlock/**`, `src/lib/admin/**`, `src/lib/notifications.ts`, `src/lib/district/**`, `src/lib/audit-actions.ts`, `scripts/**`
- frontend: `src/lib/nav/**`, `src/lib/routes/**`, `src/lib/constants/enum-labels.ts`, and the `ReleaseAudience` type in `src/lib/releases.ts`

### Wave 0: database-engineer (serial; blocks everything else)
1. [db] `prisma/schema.prisma`: the enum value, `DistrictAdminAssignment`, `User.districtAssignments`, `Announcement.broadcastId`, and schema comments that name the SQL-only CHECK. **Verify:** `prisma validate` and `prisma format` pass.
2. [db] `prisma/migrations/20260925000001_user_role_district_admin/`, `…000002_district_admin_assignment/`, `…000003_announcement_broadcast_id/`. **Verify:** `migrate diff --script` from the previous schema file shows only these objects.
3. [db] `prisma/rls-policies.sql`: one new ENABLE line. **Verify:** `npx vitest run tests/unit/rls-coverage.test.ts`.
4. [db] `src/lib/db/schema-order.ts`: the new entry. **Verify:** `tests/unit/db/schema-order.test.ts`.
5. [db] Apply the migrations as in 10.1, after reviewing `migrate status`. **Verify:** `migrate status` is clean; report which database host it ran against.

### Wave 1 (parallel)
- **backend-A (auth core):** `src/lib/auth/roles.ts`, `src/lib/auth/session.ts`, `src/lib/auth/admin-scope.ts` (new), `src/lib/auth/district-scope.ts` (new), `src/lib/auth/credentials.ts` (adds `generateReadableCredential`), `src/lib/auth/warm-routes.ts`, `src/middleware.ts`, `src/lib/actions/auth.ts`, `src/lib/audit-actions.ts` (all new action names at once, so later waves never edit it). **Verify:** `typecheck`; T1, T2 and T15 pass.
- **frontend-A (role plumbing):** `src/lib/constants/enum-labels.ts`, `src/lib/routes/district.ts` (new), `src/lib/nav/nav-config.ts`, `src/lib/nav/warm-hrefs.ts`, `src/lib/nav/not-found-links.ts`, `src/components/shell/app-header.tsx`, `src/lib/releases.ts` (the `ReleaseAudience` type only). **Verify:** `typecheck`; T18 passes.

### Wave 2 (parallel; needs backend-A)
- **backend-B (summary data):** `src/lib/learners/population.ts` (new), `src/lib/dashboard/aggregates.ts` (import change only), `src/lib/attendance/week-stats.ts` (`attendanceRatePct`), `src/lib/cache/tags.ts`, `src/lib/cache/revalidate.ts`, `src/lib/summary/**` (new: `facets.ts`, `scope-schools.ts`, `queries/*.ts`, `shape/*.ts`, `export.ts`), `src/lib/validators/summary.schema.ts` (new), `src/lib/actions/summary-export.ts` (new). **Verify:** T9, T10, T11 and T16 pass; the `EXPLAIN` output of each facet at division scope is attached.
- **backend-C (schools, accounts, transfers):** `src/lib/actions/school-management.ts`, `src/lib/actions/school.ts`, `src/lib/actions/accounts.ts`, `src/lib/admin/accounts.ts`, `src/lib/actions/enrollment.ts`, `src/lib/validators/school.schema.ts`. **Verify:** T3, T6, T7 and T13 pass.
- **backend-D (support, unlocks, announcements, search):** `src/lib/actions/support.ts`, `src/lib/support/queries.ts`, `src/lib/actions/unlock-admin.ts`, `src/lib/unlock/admin-queries.ts`, `src/lib/actions/announcement.ts`, `src/lib/actions/district-announcements.ts` (new), `src/lib/validators/announcement.schema.ts`, `src/lib/actions/global-search.ts`, `src/lib/notifications.ts`, `src/lib/district/notifications.ts` (new; the derived bell). **Verify:** T4, T5, T8 and T12 pass.
- **backend-E (script):** `scripts/create-district-admins.ts` (new), `scripts/lib/district-admin-plan.ts` (new), `.gitignore` (adds `.credentials/`). **Verify:** T17 passes; a dry run against a local database prints the plan and writes nothing.

backend-B and backend-C both call `revalidateDivisionSummary`. backend-B owns `src/lib/cache/revalidate.ts`, so it lands that helper first, and backend-C only imports it.

### Wave 3 (parallel; needs Wave 2)
- **frontend-F1 (portal shell and operations):**
  - New: `src/app/district/layout.tsx`, `src/app/district/error.tsx`, `src/app/district/not-found.tsx`, `src/app/district/{schools,support,announcements,transfers,unlocks,settings}/**`, `src/components/district/**`
  - Changed: `src/components/schools-table.tsx`, `src/components/admin/account-row-actions.tsx`, `src/components/school-head/school-info-form.tsx`, `src/components/school-head/announcement-forms.tsx` (broadcast badge, no edit or delete on broadcasts), `src/components/role-shell.tsx`, `src/components/assistant/assistant-panel.tsx`, `src/app/admin/login/**` (copy)
  - **Verify:** `typecheck` and `lint`; a manual pass on a local dev server as a district admin and as a Super Admin.
- **frontend-F2 (summary UI):** `src/components/summary/**` (new), `src/app/district/page.tsx`, `src/app/district/loading.tsx`, `src/app/district/summary/**`, `src/app/admin/summary/**`. **Verify:** `typecheck` and `lint`. `/admin/summary/<facet>?district=Alabel 1` and `/district/summary/<facet>` signed in as Ferdinand show the same numbers for the same facet.

### Wave 4: qa-test-engineer (can start writing against this spec from Wave 1)
- New: `tests/unit/auth/admin-scope.test.ts`, `tests/unit/auth/district-admin-surfaces.test.ts`, `tests/unit/actions/district-school-management.test.ts`, `tests/unit/actions/enrollment-transfer-scope.test.ts`, `tests/unit/actions/school-info-district-lock.test.ts`, `tests/unit/actions/district-announcements.test.ts`, `tests/unit/actions/summary-export.test.ts`, `tests/unit/summary/*.test.ts`, `tests/unit/import/district-admin-plan.test.ts`, `tests/unit/district-admin-role-surface.test.ts`, `tests/unit/role-exhaustiveness.test.ts`, `e2e/district-admin.spec.ts`.
- Extended: `auth-helpers`, `admin-login`, `support-ticket`, `unlock-admin`, `accounts`.
- **Verify:** `npm run test` passes. Each scope test must fail when its `schoolWhereForScope` or `loadSchoolInScope` call is deleted: check this once by hand and note it in the PR.

### Wave 5: release (whoever pushes)
- `src/lib/releases.ts` entry; `package.json` and `package-lock.json` version (both places); `docs/runbook.md`; `docs/backlog.md`. **Verify** locally, because CI is billing-locked (project memory): `prisma generate` → `typecheck` → `lint` → `test` → `build`. `migrate status` must show M1–M3 applied before the push.
- Then the operator runs the script, as in 10.4.

---

## 13. Alternatives rejected

- **A. A `District` table plus `School.districtId` (or an FK from `School.district` to `District.name`).** It would give referential integrity, at two costs:
  - It creates a second source of truth next to `School.district`. That string is read by the login district filter, report headers, global search and the importer, and written by three code paths. Retiring it later is a destructive drop.
  - An FK on `School.district` tightens a populated column, and `createSchool`, `updateSchoolInfo` and `import-schools` would then fail on any new spelling.

  Both need owner approval, and neither buys anything that the script's validation and the "no district admin" card do not already give. Revisit if districts start being renamed often; with an FK, a rename becomes one `UPDATE … ON UPDATE CASCADE`.
- **B. `User.assignedDistricts String[]`.** Fewer objects, but it has no per-row uniqueness, no `createdAt`/`createdById` per assignment, and it adds an array column to every teacher row where it means nothing.
- **C. District admins as `SUPER_ADMIN` accounts with a restriction flag.** 44 files branch on `role === "SUPER_ADMIN"` to reach across schools, and every one of them would need the flag checked. One miss is a division-wide leak. A separate role is denied by default by every existing role list.
- **D. Letting district admins pass School Head role checks (a Super Admin-style `?schoolId=` drill-down).** That puts more than 100 School Head pages and actions under per-district checks, and the need it serves, per-school figures, is already met by the per-school summary.
- **E. Caching one division-wide dataset and filtering it in memory per scope.** Only one cache entry, but every district page would load the whole division, and one forgotten filter leaks everything. Per-scope SQL, with the scope in both the where and the cache key, is the house tenancy pattern.
- **F. Fanning out `SUPPORT_TICKET_SUBMITTED` Notification rows to district admins.** No screen renders those rows today, not even for Super Admins. A derived open-ticket count in the bell is smaller and cannot go stale.
- **G. A separate `DistrictAnnouncement` table with its own reader.** It needs new read paths on School Head pages. Fanning out into the existing `Announcement` table with a `broadcastId` reuses every existing reader and costs one nullable column.
