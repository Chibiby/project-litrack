# ARAL Profile (Sections C–D–E) — dormant

The `AralProfile` row is the stored Sections C, D and E survey for one ARAL
learner: reading behaviour, environment, and suggested interventions. It is
**not part of the active teacher workflow**, and has not been since the
multi-advisory change.

Dormant means parked, not deleted. Nothing about the stored data has changed.

## What is still there, untouched

- The `AralProfile` model in `prisma/schema.prisma` and every migration that
  built it. **No rows are deleted, ever** — a school that filled these in keeps
  them.
- `src/lib/validators/aral.schema.ts` — `aralProfileSchema` and its tests.
- `saveAralProfile` in `src/lib/actions/aral.ts`, with its auth, tenancy and
  audit intact.
- The route `/teacher/aral/[gradeId]/learners/[id]/update` and its form,
  `src/components/forms/aral-update-form.tsx`. Typing the URL still works.
- Read paths: the learner detail page and the learner profile modal both render
  a saved profile when one exists, and the CSV/Excel learner export still
  carries its columns. Archive purge and the demo teardown still count and
  delete the rows with the learner that owns them.

## What was removed

Everything that asked somebody to go and complete or update one:

- The `Learner Profiling` row in the teacher sidebar (`src/lib/nav/nav-config.ts`).
- The `Profile complete?` / `Last update` columns and the
  `Complete Profiling` / `Update Profiling` buttons on `/teacher/aral`, which is
  now the ARAL Program roster and grade picker.
- The `ARAL Profile` column on `/teacher/learners`.
- The `Pending Profiles` tile on the teacher dashboard, and the
  "N ARAL learner(s) still need Sections B–E profiling" line on the School Head
  dashboard — along with the two queries behind them.
- The "ARAL profile not completed / Sections C–E appear here after Update Data is
  saved" empty states. A learner with no profile now shows nothing there, because
  an absent profile is an ordinary state rather than an outstanding task.
- The list of learners "with no ARAL profile yet" that the AI assistant used to
  be handed as pending work, and the help topic that explained the removed
  "Pending Profiles" card.

## What must keep working without one

Weekly attendance, monthly reading level, ARAL enrolment and tutor designation,
End of Terms Reports, and every export. None of them reads `AralProfile`, and
none of them may be gated on it. `tests/unit/aral-profile-dormant.test.ts`
holds that line.

## Bringing it back

Re-add navigation and calls to action. The schema, the validator, the action and
the route are all still in place, so nothing needs a migration.
