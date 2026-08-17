# School Head District Login & School Roster Import — Spec

**Source of truth (data):** `C:\Users\PC5\Downloads\List-of-School-Heads-as-of-July-6-2026-with-school-Address.xlsx`

**Scope:** Two coupled changes.

1. A one-off, human-run import that replaces the `School` table from the DepEd roster
   spreadsheet, using **district**, **school name**, and **school ID** — and nothing else — as the
   authoritative fields. Each imported school gets a School Head auth user whose initial password
   is that school's School ID.
2. A revised `/login` School Head flow: a **district filter** narrowing a **searchable school
   dropdown**, then the School ID as the first-time credential.

**Out of scope:** teacher login/registration flow, the `/admin/login` Super Admin flow, school-head
profiling, and any change to how learners are created or enrolled.

**Owner decisions locked before writing this spec:**

| Decision | Choice |
|---|---|
| Password model | School ID is a **first-time credential only**; head is then forced to set their own password |
| Existing schools | **Wipe and replace** |
| District ↔ school interaction | District is an **optional narrowing filter**; school dropdown always searchable |
| Import surface | **Committed script the owner runs**; no admin upload UI |

---

## Risk acknowledgement (R0)

Wipe-and-replace was chosen with the blast radius stated. `School` deletion cascades to
`GradeLevel`, `Section`, `Learner`, `Enrollment`, `Attendance`, `AttendanceDayMeta`,
`ReadingLevelRecord`, ARAL rows, `Announcement`, `TeacherInvite`, and every school-scoped `User`
(School Heads **and** Teachers). It is irreversible, and it leaves orphaned Supabase auth
identities unless they are deleted explicitly.

**Required consequences, all binding on the implementation:**

- The import script is **dry-run by default**. It writes nothing without `--commit`.
- Wiping requires **both** `--wipe` and `--i-understand-this-deletes-all-data`. Neither flag alone
  wipes. `--commit` alone imports without wiping.
- Before any destructive step the script prints an **inventory** of exactly what will be destroyed
  (row counts per table) and the number of Supabase auth users it will delete.
- The script deletes Supabase auth users for affected `User` rows **before** deleting the Prisma
  rows, so no identity is orphaned.
- Rows with `schoolId: null` — the Super Admin — are **never** touched. Deleting them would lock
  the owner out of `/admin`. This is a hard invariant with a test.
- **Claude never executes this script**, per CLAUDE.md's migration rule. Claude authors it; the
  owner runs it.

---

## Part A — Roster parser

### R1 — Parser module

**Required:** a new pure module `src/lib/import/school-roster.ts`. No Prisma import, no Supabase
import, no `server-only`. It takes a file path or `Buffer` and returns parsed rows plus diagnostics,
so it is unit-testable without a database and reusable if an admin upload page is added later.

```ts
export type ParsedSchoolRow = {
  schoolIdCode: string;   // normalized, string, leading zeros preserved
  name: string;           // trimmed, internal whitespace collapsed
  district?: string;      // trimmed, collapsed; undefined when blank
  region?: string;
  division?: string;
  address?: string;
  sourceRow: number;      // 1-based sheet row, for error reporting
};

export type RowError = { sourceRow: number; field: string; value: string; message: string };

export type ParseResult = {
  rows: ParsedSchoolRow[];
  errors: RowError[];
  skipped: number;                       // blank / non-school rows ignored
  headerRow: number;                     // which sheet row was detected as the header
  districts: { name: string; count: number }[];   // distinct, sorted, with row counts
  duplicateIds: { value: string; sourceRows: number[] }[];
  duplicateNames: { value: string; sourceRows: number[] }[];
};

export function parseSchoolRoster(input: string | Buffer): Promise<ParseResult>;
```

### R2 — Header detection

DepEd exports commonly carry banner/title rows above the real header, so fixed column indexes are
forbidden.

**Required:** scan rows 1–15 for the row with the most header-alias matches; that row is the header.
If no row matches at least the school-name alias **and** the school-ID alias, throw a clear error
naming the aliases it looked for — never fall back to guessing column positions.

Header text is normalized before matching: lowercased, accents stripped, punctuation and repeated
whitespace collapsed. Alias lists:

| Field | Aliases (normalized) |
|---|---|
| `schoolIdCode` | `school id`, `school id no`, `school id number`, `deped school id`, `schoolid`, `id` |
| `name` | `school name`, `name of school`, `school`, `elementary school` |
| `district` | `district`, `school district`, `dist` |
| `region` | `region` |
| `division` | `division`, `schools division` |
| `address` | `address`, `school address`, `complete address` |

School-head name columns present in the sheet are **deliberately ignored** — the owner's instruction
was district, school name, and school ID only. The parser must not read them.

### R3 — Cell normalization

**Required:**

- **School ID:** ExcelJS returns numeric cells as `number`. Coerce to string. A numeric cell is
  rendered without exponent or thousands separator. Text cells keep leading zeros verbatim
  (`"012345"` stays `"012345"`, never `12345`). Formula cells use `.result`; rich-text cells use
  `.text`.
- All string fields: trim, then collapse internal runs of whitespace to one space.
- Empty string, whitespace-only, and `"N/A"` / `"-"` sentinels become `undefined` for optional
  fields.
- A row is **skipped** (counted in `skipped`, not an error) when school name *and* school ID are
  both blank, or when the row is a subtotal/note (school-ID cell blank while name matches
  `/^(total|grand total|note|prepared by|source)/i`).
- A row is an **error** when exactly one of school name / school ID is blank — that is a real data
  defect, not a spacer.

### R4 — Validation schema

**Required:** `src/lib/validators/school-import.schema.ts` exporting `schoolRosterRowSchema`.
It reuses the `schoolIdCode` rules already in `createSchoolSchema`
(`src/lib/validators/school.schema.ts`): trimmed, 4–64 chars, `/^[A-Za-z0-9_-]+$/`. Name reuses
`nonEmpty(...).max(200)`. District/region/division reuse the `optionalShort` (≤100 char) shape;
address reuses `optionalField` (≤500).

Validation failures become `RowError` entries — the parser never throws on a bad row and never
silently drops one.

### R5 — In-sheet duplicate detection

`School.name` and `School.schoolIdCode` are both `@unique` in
`prisma/schema.prisma`. A sheet duplicate would fail mid-import and leave the table half-populated.

**Required:** the parser reports `duplicateIds` and `duplicateNames` with every offending source
row. The script refuses to commit while either list is non-empty (see R8).

---

## Part B — Duplicate-name decision branch

Whether the sheet contains repeated school names is unknown at spec time — shell tooling was
unavailable while writing this. The decision rule is fully specified here; only its input is
pending. This is not an open question for the implementer to resolve by judgement.

### R6 — Branch rule

**Step 1 of implementation** runs the parser against the real file and prints `duplicateNames`.

- **Branch B0 — `duplicateNames` is empty.** No migration. `School.name @unique` stands unchanged.
  This is the expected case and the spec's default path.
- **Branch B1 — `duplicateNames` is non-empty.** `School.name @unique` cannot hold. `database-engineer`
  authors a migration under `prisma/migrations/` that drops the `School.name` unique index and adds
  `@@unique([name, district])`. Additive-first ordering per `docs/migrations.md`. The owner applies
  it; Claude does not. The import script must then be re-checked: schools with the same name in the
  *same* district remain a hard error even under B1.

**Required:** whichever branch is taken is recorded in the implementation plan's step 1 output and
stated in the final report. If B1 triggers, the searchable dropdown must show the district alongside
the school name so two same-named schools are distinguishable to a user — this is what the `hint`
prop in R10 exists for, populated by R12.

### R7 — School ID character branch

Same structure. If any school ID contains characters outside `[A-Za-z0-9_-]`, the R4 regex rejects
it and the row becomes an error.

- **Branch C0 — no such IDs.** Regex unchanged.
- **Branch C1 — such IDs exist.** Report the exact offending values to the owner and widen the
  regex to `/^[A-Za-z0-9_\-/. ]+$/` **only** if the characters are benign punctuation. Do not widen
  to permit arbitrary input, because this value becomes a Supabase password and is embedded in a
  synthetic email local-part by `schoolHeadSyntheticEmail`.

Note that `schoolHeadSyntheticEmail` (`src/lib/auth/synthetic-email.ts`) lowercases the ID and
replaces every non `[a-z0-9-]` character with `-`. Two IDs differing only in a stripped character
would therefore collide on the same synthetic email. **Required:** the script detects synthetic-email
collisions across the whole roster before creating anything, and fails loudly if any exist.

### R7b — Minimum length: the School ID must be a legal Supabase password

Making the School ID the initial password couples it to Supabase's password policy. **Supabase
enforces a minimum password length of 6 characters** (default `password_min_length`), but
`createSchoolSchema.schoolIdCode` currently allows **4**. A 4- or 5-character school ID would parse
and validate cleanly, then fail at `auth.admin.createUser` — mid-import, after other schools were
already created.

**Required:**

- `createSchoolSchema.schoolIdCode` raises its minimum from 4 to **6**, with the message
  `"School ID must be at least 6 characters"`. This is the same schema R4 reuses, so parser and
  admin form tighten together.
- The parser reports any ID shorter than 6 characters as a `RowError` in phase 1, so the owner sees
  every offending school **before** anything is written rather than as a mid-run failure.
- If the real Supabase project has been configured with a minimum above 6, phase 1's report is still
  the place that surfaces it; the script must treat a `createUser` password-policy rejection as a
  per-row failure with the policy message included verbatim, not as a generic error.

**Check during implementation step 1:** whether any existing `School.schoolIdCode` row in the
database is shorter than 6 characters. Under wipe-and-replace this is moot for the imported data, but
raising the schema minimum would otherwise break `updateSchoolInfo` for a pre-existing short-ID
school. Report the finding; if none exist, no compatibility shim is needed.

---

## Part C — Import script

### R8 — Script phases

**Required:** `scripts/import-schools.ts`, plus `"db:import-schools": "tsx scripts/import-schools.ts"`
in `package.json`. It runs in six ordered phases, each logged with a clear heading.

1. **Parse & report.** Print header row detected, data-row count, skipped count, the district list
   with per-district counts, every `RowError`, and both duplicate lists. Exit non-zero if any errors
   or duplicates exist, unless `--allow-row-errors` is passed — which skips only the offending rows
   and still refuses on duplicates.
2. **Inventory.** Print a row count for **every** school-scoped model that a `School` delete would
   cascade into — enumerate them from `prisma/schema.prisma` rather than hardcoding a list that can
   drift, and include at minimum `School`, `User` broken down by role, `Learner`, `Enrollment`,
   `Attendance`, `ReadingLevelRecord`, and the ARAL weekly-grid tables. Print as the blast radius.
   Also print the count of Supabase auth users that will be deleted.
3. **Plan & gate.** Print `N schools to create`, `M schools to destroy`. If not `--commit`, print
   `DRY RUN — nothing written` and exit 0. If `--wipe` without
   `--i-understand-this-deletes-all-data`, refuse and exit non-zero.
4. **Wipe** (only when both wipe flags present). Delete Supabase auth users for all `User` rows
   with a non-null `schoolId`, batched with a concurrency cap, tolerating already-missing users.
   Then delete `School` rows and let Prisma cascade. `schoolId: null` rows survive untouched.
5. **Create.** Per school, mirroring `createSchool` in `src/lib/actions/school.ts` so semantics stay
   in one shape: `supabaseAdmin.auth.admin.createUser({ email: schoolHeadSyntheticEmail(schoolIdCode),
   password: schoolIdCode, email_confirm: true, app_metadata: { role: "SCHOOL_HEAD" } })` → a Prisma
   transaction creating the `School` and its `User` (`role: "SCHOOL_HEAD"`, `isActive: true`,
   `mustChangePassword: true`, `profileCompleted: false`, `fullName` = school name, `firstName`/
   `lastName` empty) → `updateUserById` adding `schoolId` to `app_metadata`.
6. **Report.** Created / skipped / failed counts, every failure with its source row, and a
   `--out <path>` artifact mapping school ID → synthetic email for ops.

### R9 — Script robustness

**Required:**

- **Concurrency cap of 5** on all Supabase admin calls. The admin API is rate-sensitive and the
  roster is in the hundreds.
- **Resumable.** If a synthetic email already exists in Supabase, reuse that auth user and reset
  its password to the School ID rather than failing the row. A half-finished run must be re-runnable.
- **Per-row isolation.** One failed school does not abort the run; it is recorded and the loop
  continues.
- Uses `DIRECT_URL` when set (port 5432), not the pooled `DATABASE_URL` — a long batch script should
  not run through PgBouncer.
- Never logs a password, even though the password is the School ID. Log the ID as an identifier only,
  never labelled as a credential.
- No `writeAudit` calls: `AuditLog.userId` would reference rows the wipe just deleted, and this is
  an offline ops action, not an in-app one.

---

## Part D — Login UI

### R10 — Searchable select primitive

**Required:** a new `src/components/ui/searchable-select.tsx`. Built on the existing
`@radix-ui/react-popover` dependency plus `Input`. **No new package** — `cmdk` is deliberately not
added.

Props: `options: { value: string; label: string; hint?: string }[]`, `value`, `onValueChange`,
`placeholder`, `searchPlaceholder`, `emptyMessage`, `disabled`, `id`.

Accessibility requirements, all mandatory:

- Trigger is `role="combobox"` with `aria-expanded`, `aria-haspopup="listbox"`, `aria-controls`.
- List is `role="listbox"`; items are `role="option"` with `aria-selected`.
- Active option tracked via `aria-activedescendant`, not DOM focus, so the search input keeps focus.
- Keyboard: `↑`/`↓` move, `Home`/`End` jump, `Enter` selects, `Escape` closes and returns focus to
  the trigger, typing filters.
- The search input is auto-focused on open.

Filtering: case-insensitive and diacritic-insensitive (`String.prototype.normalize("NFD")` with
combining marks stripped). Every whitespace-separated token in the query must match somewhere in
the label, so `"alabel central"` matches `"Alabel Central Elementary School"` and word order does
not matter. At most **100** matches render, with a muted footer stating how many more exist — this
keeps a few-hundred-row list fast without pulling in virtualization.

**Required:** the filter itself is exported as a pure function (e.g. `filterOptions`) so it is unit
tested without a DOM.

### R11 — Login page data

**Required:** `listSchoolsWithTeacherStatus()` in `src/lib/actions/school.ts` adds `district: true`
to its `select` and to its returned shape. It is already wrapped in `cachedQuery` against the
`schoolsList` tag, so no new cache plumbing or invalidation is introduced.

`src/app/login/page.tsx` passes the enriched list through unchanged. The district option list is
derived from the schools — distinct non-empty districts, sorted alphabetically — not hardcoded and
not a second query.

### R12 — LoginForm district filter

**Required:** on the existing `select-role` screen of `src/components/forms/login-form.tsx`, above
the school field:

- A district `Select` whose first option is **"All districts"** and is the default. District never
  gates the school field — the school dropdown is always enabled and always searchable, per the
  owner's choice.
- Schools shown = all schools when "All districts" is selected, otherwise only that district's
  schools. Schools with a blank district appear under "All districts" only.
- Changing district **clears the selected school** if that school is not in the newly chosen
  district, and clears the derived `teachersOpen` state with it. A stale selection surviving a
  filter change is a defect.
- The school field becomes `SearchableSelect` (R10) in place of the current `Select`.
- The existing Teachers / School Head buttons, the `teachersOpen` gate, `TEACHERS_UNLOCK_HELP`
  copy, and the forgot-password link are unchanged.

**Required:** the district-narrowing and stale-clearing logic is extracted as pure helpers so it can
be unit tested without rendering.

### R13 — School Head password field is copy-only

`loginSchoolHead` already calls `signInWithPassword` with whatever the user types, and `requireUser`
already redirects to `/account/set-password` when `mustChangePassword` is true. The first-time
credential flow therefore needs **no server change**.

**Required:** in the `school-head` screen, relabel the field to **"School ID or password"** and
replace the current activation-credential helper text with: *"First time signing in? Enter your
School ID. You'll choose your own password next."* The `PasswordInput` component,
`name="password"`, and `autoComplete="current-password"` stay as they are.

**Explicitly forbidden:** changing `loginSchoolHead`'s signature, its rate-limit key, its audit
calls, or its generic `"Login failed. Please contact your administrator."` error text. That message
is deliberately non-enumerating and must not start distinguishing "wrong password" from "no such
school".

### R14 — createSchool initial password

**Required:** `createSchool` in `src/lib/actions/school.ts` sets the new School Head's Supabase
password to `parsed.data.schoolIdCode` instead of `generateActivationCredential()`, so schools made
at `/admin/schools/new` follow the same single rule as imported ones: *the initial password is the
School ID.* `mustChangePassword: true` already forces a reset on first login and stays.

The action's return type renames `activationCredential` to **`initialPassword`**, because a field
named "activation credential" that now carries the School ID would mislead every future reader.
`src/components/forms/create-school-form.tsx` and its success UI update to the new field name, and
their copy must stop describing the value as a generated credential — it is the School ID the head
will type once, then replace.

If `generateActivationCredential` has no remaining callers afterwards, leave the function in place;
teacher invite flows may still reference it and removing it is out of scope.

---

## Part E — Tests

### R15 — Required coverage

**Vitest (`tests/unit/`):**

- Parser: banner rows above header; header alias matching; numeric school ID coerced to string;
  leading zeros preserved; blank-row skip vs. one-field-blank error; subtotal/note rows skipped;
  duplicate ID and duplicate name reporting; district counts.
- Synthetic-email collision detection (R7).
- `filterOptions`: case-insensitivity, diacritic-insensitivity, multi-token order-independence,
  100-item cap.
- District narrowing + stale-school-clearing helpers (R12).
- Fixtures are small generated `.xlsx` files written by the test itself via `exceljs`, not the real
  roster file — tests must not depend on a file in the owner's Downloads folder.

**Testing Library:** searchable select keyboard nav and `aria-activedescendant`; LoginForm district
change narrows the list and clears a stale school selection.

**Playwright (`e2e/`, opt-in):** select district → search for a school → sign in with School ID →
land on `/account/set-password`. No server auto-start, per `playwright.config.ts`.

**Not tested against a live database.** The import script's phases 4–6 are exercised only in
dry-run against a parsed fixture. A test that wipes a real table is forbidden.

### R16 — Gate

`npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all pass before the work is
reported done, matching the CI order in `.github/workflows/ci.yml`.

---

## Part F — Ownership

Per `.claude/agents/` boundaries:

| Agent | Files |
|---|---|
| `backend-developer` | `src/lib/import/school-roster.ts`, `src/lib/validators/school-import.schema.ts`, `src/lib/actions/school.ts`, `scripts/import-schools.ts`, `package.json` script entry |
| `frontend-developer` | `src/components/ui/searchable-select.tsx`, `src/components/forms/login-form.tsx`, `src/components/forms/create-school-form.tsx`, `src/app/login/page.tsx` |
| `database-engineer` | `prisma/**` — engaged **only** under branch B1 (R6) |
| `qa-test-engineer` | `tests/**`, `e2e/**`, and running the R16 gate |

`scripts/**` is unclaimed by the existing agent definitions; it is assigned to `backend-developer`
here because the script is server-side logic against Prisma and Supabase.

---

## Non-goals

- No admin upload UI for the roster.
- No change to teacher login, teacher self-registration, or OTP.
- No new dependency, in particular not `cmdk`.
- No RLS policy change.
- No migration at all under branch B0.
