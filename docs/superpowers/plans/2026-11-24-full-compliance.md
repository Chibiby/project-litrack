# Full Compliance Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Full compliance" Division Summary facet. It shows each school's
compliance status, its streak, the recently achieved and lost lists, a district
ranking, a leaderboard, a recognition list, an export, and a per-school history
built from a small change log.

**Architecture:**
- A daily cron diffs each active school's base compliance state against
  `SchoolComplianceState` and writes a `SchoolComplianceEvent` row only on a
  change.
- A new summary facet reuses the existing compliance SQL and classifier, merges
  in the state and event rows, and shapes them in pure code.
- A dedicated panel renders the facet inside the existing `SummaryFacetView`.

**Tech Stack:** Next.js 16 App Router, Prisma 6 (Neon Postgres), Zod, Tailwind +
shadcn/ui, Vitest, Cloudflare Workers cron.

**Spec:** `docs/superpowers/specs/2026-11-24-full-compliance-design.md`

## Global Constraints

- "Compliant" means `classifyCompliance(...).flags.length === 0`. Never a second
  definition.
- Tenancy: every row that reaches the shape passes through `scopeRaw`. State
  and event rows are merged into the raw rows by `school_id` BEFORE `scopeRaw`,
  so the fence covers them.
- The migration is additive only: one enum and two tables. It is named
  `20261124000001_school_compliance_state`. It is applied to production
  (Neon, via `DIRECT_URL`) only after `prisma migrate status`, and before the
  code push.
- Dates are local `YYYY-MM-DD` keys from `src/lib/date-keys.ts`
  (`formatLocalDateKey`, `schoolToday`). Never use `toISOString()` for a day.
- Enum UI labels go in `src/lib/constants/enum-labels.ts`.
- Status thresholds: Newly compliant under 7 days; Consistently compliant 30+
  days; At risk when the last attendance is 10–14 days old, or when this month
  has no reading level and 5 or fewer days remain in it.
- Tables follow the `data-table-system` skill. Stat values use `<CountUp>`.
- Release: one entry, v2.84.0 (a feature), in `src/lib/releases.ts`,
  `package.json` and `package-lock.json`.
- File ownership: `prisma/**` belongs to `database-engineer`.

## Review Focus

1. A school with no active school year but with learners: it must show "Not
   evaluated", not "Non-compliant" (classify still flags DISCREPANCIES for it).
2. The first cron run on an empty state table must write states with
   `compliantSince = today` and NO events, or every school would show "Newly
   compliant".
3. The cron running twice on the same day must write nothing the second time.
4. A district admin must never see another district's school in any list,
   ranking, leaderboard or export (the fence runs before the shape).
5. A school that turns compliant, then flagged, then compliant again within 7
   days: Lost must not list it (it is compliant now). Recently achieved must
   list it once, with the latest date.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261124000001_school_compliance_state/migration.sql`
- Modify: `src/lib/constants/enum-labels.ts`
- Test: `tests/unit/constants/enum-labels.test.ts` (extend if it enumerates enums; otherwise rely on its existing exhaustiveness check)

**Interfaces:**
- Produces:
  - `enum ComplianceBaseStatus { COMPLIANT NON_COMPLIANT NOT_EVALUATED }`
  - `model SchoolComplianceState { schoolId String @id; status ComplianceBaseStatus; compliantSince String?; lastCheckedOn String; flags String[]; createdAt DateTime @default(now()); updatedAt DateTime @updatedAt; school School @relation(onDelete: Cascade) }`
  - `model SchoolComplianceEvent { id String @id @default(cuid()); schoolId String; dateKey String; fromStatus ComplianceBaseStatus?; toStatus ComplianceBaseStatus; flags String[]; createdAt DateTime @default(now()); @@index([schoolId, dateKey]); @@index([dateKey]) }`, with a School relation and onDelete Cascade.
  - The back-relations on `School`.
  - `COMPLIANCE_BASE_STATUS_LABELS` in enum-labels: "Compliant", "Non-compliant", "Not evaluated".

- [ ] **Step 1:** Edit the schema. Run `npx prisma format` and `npx prisma validate`. Expected: "The schema is valid".
- [ ] **Step 2:** Generate the SQL with `npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script --shadow-database-url <local shadow>`. Without a shadow DB, hand-write the SQL to match. Check that it holds only `CREATE TYPE`, `CREATE TABLE`, `CREATE INDEX` and `ADD CONSTRAINT`: no DROP, no ALTER of existing columns.
- [ ] **Step 3:** Add the labels. Run `npx prisma generate`, then `npx tsc --noEmit`. Expected: exit 0.
- [ ] **Step 4:** Commit: `feat(db): compliance state and change log tables`.

### Task 2: Pure status rules

**Files:**
- Create: `src/lib/summary/shape/full-compliance.ts`
- Test: `tests/unit/summary/full-compliance-status.test.ts`

**Interfaces:**
- Consumes: `SchoolComplianceFacts` and `classifyCompliance` from `shape/compliance.ts`.
- Produces:
  - `type FullComplianceStatus = "CONSISTENT" | "FULL" | "NEW" | "AT_RISK" | "NON_COMPLIANT" | "NOT_EVALUATED"`
  - `FULL_COMPLIANCE_STATUS_LABELS: Record<FullComplianceStatus, string>`, with the spec's wording.
  - `baseStatusOf(facts: SchoolComplianceFacts, hasActiveYear: boolean, todayKey: string): { base: ComplianceBaseStatus; flags: ComplianceFlag[] }`. NOT_EVALUATED when `liveLearners === 0` or `!hasActiveYear`.
  - `streakDays(compliantSince: string | null, todayKey: string): number | null`, inclusive.
  - `isAtRisk(facts, todayKey): boolean`.
  - `displayStatus(args: { base; compliantSince: string | null; trackingStart: string | null; facts; todayKey }): FullComplianceStatus`. Precedence: NOT_EVALUATED > NON_COMPLIANT > AT_RISK > NEW > CONSISTENT > FULL. NEW requires `compliantSince > trackingStart`.

- [ ] **Step 1: Write failing tests:**
  - `"no learners → NOT_EVALUATED"`
  - `"learners but no active year → NOT_EVALUATED even though classify flags it"`
  - `"any flag → NON_COMPLIANT"`
  - `"last attendance 11 days ago, zero flags → AT_RISK"`; at 9 days, not at risk
  - `"no reading this month with 5 days left → AT_RISK"`; with 6 left, not
  - `"compliant 3 days after tracking start, since 3 days → NEW"`
  - `"compliant since tracking start 3 days ago → FULL, not NEW"`
  - `"since 30 days → CONSISTENT"`; 29 days → FULL
  - `streakDays("2026-11-20","2026-11-24") === 5`
  - Use fixed facts builders and fixed date keys.
- [ ] **Step 2:** Run `npx vitest run tests/unit/summary/full-compliance-status.test.ts`. Expected: FAIL (the module is missing).
- [ ] **Step 3:** Implement. Month-days-left comes from the date-keys helpers, not `Date` UTC.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(summary): full compliance status rules`.

### Task 3: Daily recorder and cron

**Files:**
- Create: `src/lib/compliance/record.ts`
- Create: `src/app/api/cron/compliance-record/route.ts`
- Modify: `worker.js` (`CRON_ROUTES`: `"5 16 * * *": "/api/cron/compliance-record"`)
- Modify: `wrangler.jsonc` (add `"5 16 * * *"` to `triggers.crons`)
- Test: `tests/unit/compliance/record.test.ts`, `tests/unit/compliance/record-route.test.ts`

**Interfaces:**
- Consumes: `queryComplianceRows(todayKey)`, `complianceFacts`, and `baseStatusOf` (Task 2).
- Produces: `recordComplianceChanges(todayKey: string): Promise<{ checked: number; created: number; changed: number; skipped: boolean }>`.

Behaviour:
- Only live, active schools count.
- Load every `SchoolComplianceState` row.
- If every school's `lastCheckedOn === todayKey`, return `skipped: true`.
- No state row: create the state row with `compliantSince = base === COMPLIANT ? todayKey : null`, and no event.
- Status unchanged: update `lastCheckedOn` (and `flags`) only.
- Status changed: update the state. `compliantSince` becomes `todayKey` on entering COMPLIANT and `null` otherwise. Insert one event with from/to and the flags.
- Write everything in one `prisma.$transaction`, then call the `divisionSummary` revalidate helper from `src/lib/cache/revalidate.ts`.
- The route authorises with `isCronAuthorized` and returns JSON. Wrap it in `route()`, as `summary-warm` does.

- [ ] **Step 1: Write failing tests** with mocked `prisma` and `queryComplianceRows`:
  - `"first run creates states and no events"`
  - `"same day second run skips"`
  - `"COMPLIANT→NON_COMPLIANT writes one event and clears compliantSince"`
  - `"NON_COMPLIANT→COMPLIANT sets compliantSince to today"`
  - `"inactive school is ignored"`
  - Route: `"401-style failure without CRON_SECRET"` and `"200 with counts when authorised"`.
- [ ] **Step 2:** Run `npx vitest run tests/unit/compliance`. Expected: FAIL.
- [ ] **Step 3:** Implement the recorder, the route and the cron wiring.
- [ ] **Step 4:** Run `npx vitest run tests/unit/compliance tests/unit/summary/warm.test.ts`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(compliance): daily change-log recorder and cron`.

### Task 4: Facet query, shape and registration

**Files:**
- Modify: `src/lib/summary/types.ts`. Add `"full-compliance"` to `SUMMARY_FACET_IDS` right after `"compliance"`. Add the optional `fullCompliance?: FullComplianceView` to `FacetResult`.
- Modify: `src/lib/summary/facet-meta.ts`. Add the label "Full compliance" with the description "Schools with complete, up-to-date records and no discrepancies, and how long they have kept it."
- Create: `src/lib/summary/queries/full-compliance.ts`
- Modify: `src/lib/summary/facets.ts`. Register the facet with `activeSchoolsOnly: true` and `levelOnlyParamsSchema`. Its export uses `exportListReportTable`.
- Test: `tests/unit/summary/full-compliance-shape.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3 and `queryComplianceRows`.
- Produces:
  - `type RawFullComplianceRow = RawComplianceRow & { state_status: ComplianceBaseStatus | null; compliant_since: string | null; tracking_since: string | null; events: { dateKey: string; from: ComplianceBaseStatus | null; to: ComplianceBaseStatus; flags: string[] }[] }`. The events cover the last 90 days, newest first.
  - `queryFullComplianceRows(todayKey): Promise<RawFullComplianceRow[]>`. It runs `queryComplianceRows`, then two Prisma reads (all states; events with `dateKey >= today-90`), and merges them by school id.
  - `shapeFullCompliance({ raw, schools, level, todayKey, computedAt }): FacetResult`. It fills `fullCompliance` with:
    - `cards`: `{ total, compliant, consistent, ratePct }`
    - `ranking`: `{ district, compliant, total, pct }[]`, sorted by pct desc then total desc
    - `recent`: schools with an event to COMPLIANT in the last 7 days that are compliant now
    - `lost`: schools with an event COMPLIANT→NON_COMPLIANT in the last 7 days that are non-compliant now, with their flags
    - `leaderboard`: the top 10 by streak
    - `recognition`: every CONSISTENT school
    - `directory`: `{ schoolId, name, district, flagCount, flags, streak, status, history }[]`
    - `trackingSince`: the minimum `tracking_since`
  - `lists` holds the Recognition list. `exportList` is the directory, with columns School, School ID, District, Status, Streak (days), Flags.
  - Ruling: the export always holds every school in scope. The Status column lets the reader filter in Excel, so recognition is "Status = Consistently compliant", and the export needs no extra param. If the owner later wants a filtered export, add `status` to the facet's params schema.

- [ ] **Step 1: Write failing tests:**
  - `"only scoped schools appear in every list"`: build raw rows for two districts and scope to one.
  - `"rate = compliant / total active"`
  - `"ranking orders by percent then size"`
  - `"recent lists a school once, with its latest date"`
  - `"lost excludes schools compliant again"`
  - `"leaderboard caps at 10 and sorts by streak desc"`
  - `"exportList has one row per school"`
- [ ] **Step 2:** Run `npx vitest run tests/unit/summary/full-compliance-shape.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement and register. Update any exhaustive facet tests (nav, facet index, warm) that list facet ids. Add the new id; do not loosen the assertion.
- [ ] **Step 4:** Run `npx vitest run tests/unit/summary`. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(summary): full compliance facet`.

### Task 5: Panel UI

**Files:**
- Create: `src/components/summary/full-compliance-panel.tsx`, plus a client child for the directory filters and the row expansion.
- Modify: `src/components/summary/summary-facet-view.tsx`. For `facetId === "full-compliance"`, render `<FullCompliancePanel view={result.fullCompliance} ... />` in place of the generic sections. The scope bar and the Export menu stay.
- Test: `tests/components/full-compliance-panel.test.tsx`

**Interfaces:**
- Consumes: `FullComplianceView` (Task 4), `StatCard` (`src/components/dashboard/teacher/stat-cards.tsx`), `ResponsiveTable` (`src/components/ui/responsive-table.tsx`), and `TabNav`/select primitives.

Layout:
1. Four stat cards: Total active schools · Fully compliant schools · Consistently compliant · Overall compliance rate (with a progress bar).
2. District ranking as horizontal bars. Hidden when only one district is in scope.
3. Recently achieved and Lost compliance as two cards. Each shows an empty-state line when it has no schools.
4. Longest streaks (top 10) and Recognition.
5. The directory, with a Status select (`?status=`, the six statuses plus All) and a District select (the existing `?district=` param). It has the columns School · Flags (numeric) · Streak (numeric, "—" when null) · Status (badge). Each row expands in place to its history list.
6. A footer reading "Updated every 5 minutes · Tracking since <date>".

Status badge colours use the existing badge variants. Never violet, which is reserved for ARAL.

- [ ] **Step 1: Write failing tests:**
  - `"renders the four cards with their values"`
  - `"hides district ranking for one district"`
  - `"status filter narrows the directory"`
  - `"expanding a row shows its history"`
  - `"empty recent/lost show their empty lines"`
  - `"streak cell shows — for non-compliant"`
- [ ] **Step 2:** Run `npx vitest run tests/components/full-compliance-panel.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run it again. Expected: PASS.
- [ ] **Step 5:** Commit: `feat(summary): full compliance page`.

### Task 6: Verify, release, apply, ship

- [ ] **Step 1:** Run the gates: `npx prisma generate`, `npx tsc --noEmit`, `npm run lint` (0 errors), `npx vitest run` (all pass).
- [ ] **Step 2:** Apply the migration to the local or dev database. Run the recorder once through the route with `CRON_SECRET`. Open `/admin/monitoring/division-summary/full-compliance` as Super Admin (demo visible), then as a District admin through Test Lab. Check the cards, ranking, lists, filters, row expansion and export at desktop and phone width, in light mode.
- [ ] **Step 3:** Add the release entry v2.84.0 and bump `package.json` and `package-lock.json`. Commit: `release 2.84.0`.
- [ ] **Step 4:** Get the owner's go-ahead. Then run `prisma migrate status` against prod (`DIRECT_URL`, confirmed by hostname only), read the pending list, and run `prisma migrate deploy`.
- [ ] **Step 5:** When the owner asks, push `feat/district-summary-scope:main`. Check that the Workers deploy works and that the new cron trigger is live.
