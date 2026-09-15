# ARAL Profile (Sections C–D–E)

The `AralProfile` row is the stored Sections C, D and E survey for one ARAL
learner: reading behaviour, outside factors, and suggested interventions.

It was dormant from the multi-advisory change until 1.19.0, when the project
owner asked for it back as its own page under **ARAL Program**.

## Where teachers reach it

- **ARAL Profiling** (`/teacher/aral/profiling`), a row in the teacher sidebar's
  ARAL Program group. It lists every ARAL learner the teacher is the designated
  tutor for, across all their grades, with All / Pending / Completed tabs and a
  Complete profile or Update profile button per learner.
- The **Pending Profiles** card on the teacher dashboard links to the Pending
  tab (`aralProfilingHref()` in `src/components/dashboard/teacher/hrefs.ts`).

Both use tutor scope (`aralLearnerScope`), because `saveAralProfile` only
accepts the designated tutor. The card's count and the page's Pending tab must
stay on the same scope, or they disagree.

The form itself is still `/teacher/aral/[gradeId]/learners/[id]/update`
(`src/components/forms/aral-update-form.tsx`); its back link returns to
ARAL Profiling.

## No absenteeism questions

Section C no longer asks for absenteeism frequency, reasons or a specify
field. Weekly Attendance already records every absence, so the profile does
not count it twice.

- `aralProfileSchema` has no absenteeism fields; Zod strips them if a stale
  form sends them, so saving never overwrites an old answer.
- `AralProfile.absenteeismFrequency` is nullable
  (`20260915000006_aral_profile_absenteeism_optional`). Profiles saved before
  keep their stored answers; new profiles leave the columns empty.
- The learner detail page and the learner profile modal do not show them.
  The learner export still carries the columns for old rows.

## Still not asked for anywhere else

- No Complete/Update Profiling buttons or status column on `/teacher/aral`
  (the ARAL Program roster) or `/teacher/learners`.
- No School Head dashboard nudge about missing profiles.
- The AI assistant is not handed a list of missing profiles.

## What must keep working without one

Weekly attendance, monthly reading level, ARAL enrolment and tutor designation,
End of Terms Reports, and every export. None of them reads `AralProfile`, and
none of them may be gated on it. A learner with no profile shows nothing in its
profile sections, because an absent profile is an ordinary state.
`tests/unit/aral-profile-dormant.test.ts` holds these lines.
