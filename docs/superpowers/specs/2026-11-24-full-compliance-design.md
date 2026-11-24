# Full Compliance page (Division Summary) — design

Date: 2026-11-24. Status: proposed, awaiting owner approval.

## Why

The Division Summary already has a **Non-compliance** page (facet `compliance`)
that lists flagged schools. Division and District admins also need the other
side: which schools are clean, which ones only just became clean, which ones
stay clean, and which ones are slipping. That supports monitoring visits and the
recognition of consistently compliant schools.

## Goals

- A **Full Compliance** page in the Division Summary for the Division Admin
  (`SUPER_ADMIN`, whole division) and District Admins (their district), with the
  same scope, demo, level and export rules as every other summary facet.
- Six statuses, so a school that only just finished is told apart from one that
  is consistently compliant.
- Streaks, history, recently achieved, lost compliance, district ranking, a
  leaderboard, a recognition list and export.

## Non-goals

- No new flags. "Compliant" means zero flags under the existing
  `classifyCompliance` rules (`src/lib/summary/shape/compliance.ts`). The two
  pages must never disagree on whether a school is flagged.
- No certificates or printed awards. Recognition is a list, and its export.
- No School Head or Teacher view.
- No backfill of history. Nothing recorded it before this ships.

## Anti-goals

- A school shown as compliant on this page and flagged on Non-compliance.
- A school's status leaking outside the viewer's scope (district or demo).
- Writing a row per school per day. The owner keeps the database small
  (free-tier size, see the audit decision of 2026-09-27).

## Statuses

The status is decided at read time from today's facts plus one stored date,
`compliantSince`. The first matching row wins:

| Status | Condition |
|---|---|
| Not evaluated | The school has no learners encoded, or no active school year. |
| Non-compliant | One or more flags today. |
| At risk | Zero flags, but the last attendance mark is 10–13 days old (it is flagged at 14). Ruling during build: reading levels and MOSY have no grace period (Non-compliance flags them on day one), so they can never make a compliant school at risk. |
| Newly compliant | Zero flags, and became compliant within the last 7 days (the streak began with a recorded change, not on the day tracking started). |
| Consistently compliant | Zero flags for 30 or more consecutive days. |
| Fully compliant | Zero flags, none of the above. |

**Streak** = days from `compliantSince` to today, inclusive. It is shown only
for compliant statuses.

**Tracking starts on the ship date.** No school can show "Consistently
compliant" until 30 days after release. The page says "Tracking since <date>"
until then.

## History: a change log, not daily snapshots (approved)

- A new daily job runs at 00:05 Manila time (cron `5 16 * * *`, route
  `/api/cron/compliance-record`, authorised with `CRON_SECRET` like the
  others). It runs the existing division-wide compliance query once and
  compares each school's base state (`COMPLIANT` / `NON_COMPLIANT` /
  `NOT_EVALUATED`) with the stored one.
- **`SchoolComplianceState`**: one row per school. It holds `status`,
  `compliantSince` (a local date key or null), `lastCheckedOn`, and the flags at
  the last change.
- **`SchoolComplianceEvent`**: one row per change only. It holds `schoolId`,
  `dateKey`, `fromStatus`, `toStatus`, `flags`.
- Size: about 333 state rows, plus a handful of events a day.
- The migration is additive: two new tables and one new enum. It is applied to
  production before the code push, after `prisma migrate status`.

## Page contents (inspired by the owner's mockup)

1. **Stat cards** (with count-up): Total active schools · Fully compliant
   schools (all compliant statuses) · Consistently compliant · Overall
   compliance rate, with a bar.
2. **District compliance ranking**: percent of active schools compliant per
   district, then the count. Hidden for a single-district scope.
3. **Recently achieved** (last 7 days) and **Lost compliance** (compliant
   within the last 7 days, flagged now, with the new flags), side by side.
4. **Longest streaks**: the top 10 schools by streak.
5. **Recognition**: every consistently compliant school, with its streak.
6. **School compliance directory**: School · District · Flags · Streak ·
   Status. It has District and Status filters (URL params), follows the
   data-table-system skill, and each row expands to that school's change
   history (the last 90 days of events).
7. **Export**: the directory and the recognition list through the existing
   summary export path.
8. Footer: "Updated every 5 minutes" (the summary cache TTL) and "Tracking
   since <date>".

Navigation: a new facet `full-compliance`, labelled "Full compliance", placed
next to "Non-compliance" in the summary nav and index.

## Approaches considered

1. **Change log (chosen)**: small, exact, cheap. Streaks begin at the ship
   date.
2. Daily snapshot of every school: simple queries, but about 120k rows a year,
   against the owner's size constraint.
3. No history (today's status only): no streaks, Newly or Lost, which loses
   the point of the request.

## Left to the builder

The visual details within the existing summary components, the copy beyond the
labels above, and the chart choice for the district ranking (bars).
