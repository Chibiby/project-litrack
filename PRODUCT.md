# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary: the ARAL teacher.** A DepEd public-elementary classroom teacher in a
Sarangani school, assigned one or more grade levels and a set of sections. They
are not a data analyst and did not ask for a dashboard; they were given one on
top of a teaching load. They open LITRACK on a **laptop or desktop** — faculty
room or at home, outside class hours — not on a phone mid-lesson. Sessions are
short and purposeful: mark the week's attendance, enter the month's reading
levels, finish a learner's ARAL profile, pull a report when the School Head asks.

Secondary, both confirmed in code and out of scope for this surface:

- **School Head** — owns the school: grade levels, sections, teacher approval,
  announcements, school-wide reporting.
- **Super Admin** — owns the tenant estate and can impersonate any role
  (`?schoolId=`), so every teacher-scoped view must also render correctly for an
  admin who has no personal grade assignment.

## Product Purpose

LITRACK tracks learners in the DepEd **ARAL** reading-remediation program so a
school can tell, per learner and per grade, whether reading intervention is
working. It replaces paper forms and spreadsheet workarounds with one
multi-tenant record: profile the learner, mark attendance weekly, assess reading
level monthly, and report at end of term.

Success is not "the dashboard looks complete." Success is that a teacher's
weekly attendance and monthly reading records are **submitted on time and
accurate**, and that a learner stuck below grade level is visible to the person
who can act — the teacher — before the term ends.

## Positioning

The mechanism a neighbouring school-MIS could not truthfully copy: LITRACK holds
the **DepEd ARAL instrument itself** — the four-band reading profile in both
English and Filipino, frustration subtypes, and the Sections B–E profiling survey
(reading behaviour, external factors, suggested interventions) — as first-class
structured data rather than as an uploaded form. Because the profile is
structured, reading level is longitudinal: `ReadingLevelRecord` is one row per
learner per week, so movement between bands is a queryable fact, not a comparison
of two PDFs.

## Operating Context

- **Roles and tenancy.** `School` is the tenant root; nearly every table carries
  `schoolId`. Every teacher-scoped query is filtered by both school and the
  teacher's own grade/learner scope.
- **The teacher's rituals**, and the routes that serve them:
  - `/teacher` — dashboard (this surface).
  - `/teacher/learners` — roster, per-learner detail and edit.
  - `/teacher/aral/[gradeId]/attendance` — **weekly** attendance grid, Monday-keyed.
  - `/teacher/aral/[gradeId]/reading-level` — **monthly** reading-level entry.
  - `/teacher/reports` — end-of-term reports, printable.
  - `/teacher/profiling` — first-run teacher profiling, blocks the app until done.
- **Cadence is the spine of the job.** Attendance is weekly (Monday `weekStart`),
  reading level is monthly, profiling is once per learner, reports are per term.
  A teacher's real question is scoped by that calendar, not by "all time."
- **Two independent teacher–learner axes.** `Learner.teacherId` is the *adviser*;
  `Learner.aralTeacherId` is the *ARAL* designation. They need not be the same
  person, and a learner may be ARAL-designated to a teacher who has no advisory
  section. Any teacher-scoped count must say which axis it means.
- **Onboarding order is real.** A teacher can exist before a School Head has
  created grade levels, before an active school year is set, and before any
  learner is rostered. The zero state is not an edge case; it is week one.
- **Dates are local (UTC+8).** Attendance and weekly grids key off local
  `YYYY-MM-DD` via `src/lib/date-keys.ts`. `toISOString()` shifts the day.

## Capabilities and Constraints

**Data available to a teacher surface** (all confirmed in `prisma/schema.prisma`):

- `Learner` — names, age, gender, ethnicity, `isAralLearner`, grade/section/adviser
  pointers, and **Section A** on the learner row itself: `englishReadingProfile`
  and `filipinoReadingProfile` (`ReadingProfile`: `NON_DECODER_LOW_EMERGENT` →
  `FRUSTRATION_HIGH_EMERGENT` → `INSTRUCTIONAL_DEVELOPING` →
  `INDEPENDENT_GRADE_READY`), plus per-language `FrustrationSubtype[]`.
- `ReadingLevelRecord` — one row per learner per `weekStart`: English and Filipino
  profile, and optional `wordRecognitionLevel`, `readingComprehensionLevel`,
  `writingLevel`, `notes`. This is the longitudinal series.
- `Attendance` — one row per learner per date, `PRESENT | ABSENT | LATE | EXCUSED`,
  with `weekStart`; `AttendanceDayMeta.isHoliday` marks non-school days per grade.
- `AralProfile` — Sections C–E per ARAL learner: absenteeism frequency, letter
  recognition, letter–sound correspondence, word recognition, home literacy
  environment, parental support, classroom environment, language considerations,
  **suggested interventions**, LSEN observations, further assessment.
- `Enrollment` + `SchoolYear` — the longitudinal enrolment record; one active
  school year per school.
- `Announcement` — published by the School Head, school-scoped.
- `AuditLog`, `GradeLevel`, `Section`, `TeacherSection`, `TeacherProfile`.

**Constraints future work must preserve:**

- Cross-tenant leakage is the worst bug shippable here. Every query carries
  `schoolId`; ownership checks throw a generic "Not found".
- Super Admin passes every role check by default, so role-scoped queries branch
  on `user.role === "SUPER_ADMIN"` explicitly.
- Every role page is `force-dynamic`; caching runs through `cachedQuery` with
  centralized tags in `src/lib/cache/tags.ts` and named invalidation helpers.
- Soft delete via `deletedAt`; archive is the separate `archivedAt`.
- Server actions return `{ ok: true | false }` rather than throwing, guard auth
  first, re-validate with Zod, write audit, then revalidate.
- Migrations are authored, never applied, by tooling. A human applies them.
- **No `Notification` model exists.** Anything that looks like an alert must be
  derived from data already loaded, not persisted.
- **No per-learner deadline or lock model exists.** Cadence is inferable from
  `weekStart` / month, but "locked", "due date", and "submitted" are not columns.
  Do not render them as if they were.

**Undecided / not established:** whether attendance and reading records ever
formally lock; whether teachers get notification persistence; whether the
dashboard is the ARAL surface or the whole-roster surface when a teacher has both
ARAL and non-ARAL learners.

## Brand Commitments

- Name: **LITRACK**. Program: **ARAL**. Tenant example in the design mock:
  Malandag Central Elementary.
- **Violet is reserved as the ARAL accent** (`--violet`, hue 255) — a semantic
  commitment recorded in `tailwind.config.ts` and CLAUDE.md, not a decoration.
  Blue is primary, amber is secondary. Violet must not be spent on non-ARAL UI.
- Existing chrome to sit inside, not replace: `RoleShell` sidebar with grouped
  nav, sticky `AppHeader` with quick search (⌘K), notifications popover, theme
  toggle, and the account menu.
- Light and dark themes are both real and tokenized in `src/app/globals.css`.
- Institutional marks in `public/`: DepEd MATATAG, DepEd Sarangani, Bagong
  Pilipinas, ARAL.
- Typeface: Inter (`--font-inter`), already loaded.

## Evidence on Hand

- Live schema and aggregates: `prisma/schema.prisma`,
  `src/lib/dashboard/aggregates.ts`, `src/lib/teachers/scope.ts`.
- Incumbent teacher dashboard: `src/app/teacher/(app)/page.tsx` and
  `src/components/dashboard/teacher-dashboard-sections.tsx`.
- A user-supplied **design mock** of a proposed teacher dashboard. It is a
  picture, not shipped code — none of its copy exists in the repo, and two of its
  panels ("Automatic Data Lock", per-task "Due" dates) describe a lock/deadline
  model the schema does not have.
- Source requirements: `docs-source-requirements.txt`,
  `docs/requirements-traceability.md`.
- **Data volume is pilot-stage: mostly empty.** Confirmed by the user. Few or no
  reading records exist today. Trends must be honest at zero rows and must not
  fabricate history.
- No testimonials, benchmarks, pricing, or third-party endorsements exist. Do not
  invent them.

## Product Principles

1. **The calendar is the unit of work.** Weekly attendance, monthly reading level,
   per-term reports. A teacher-facing number without its period attached is a
   number they cannot act on.
2. **Name the learner.** The program exists to move individual children between
   reading bands. Aggregates are navigation toward a learner, never the endpoint.
3. **Honest at zero.** A school in week one has no records. Empty is the common
   case, not the edge case, and an empty panel must teach the next action rather
   than display a zero.
4. **Never imply a rule the system does not enforce.** No due dates, no locks, no
   "submitted" state unless a column backs it.
5. **Violet means ARAL.** Colour carries meaning here; spending the ARAL accent on
   ordinary chrome destroys the one semantic signal the palette has.

## Accessibility & Inclusion

- Both light and dark themes must meet WCAG AA on text and interactive controls;
  the amber secondary already carries a dark foreground for that reason.
- Status must never be encoded by colour alone — attendance states and reading
  bands need a label, shape, or value beside the hue.
- Reports print to PDF via the browser; print rules exist in `globals.css`.
- The app serves a bilingual (English / Filipino) reading programme; both
  languages are first-class in the data and must be first-class in the UI.
