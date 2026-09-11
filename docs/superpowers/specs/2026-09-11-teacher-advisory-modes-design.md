# Teacher advisory modes: Floating, Multi-grade, and the designation that decides

Status: approved design (owner, 2026-09-11), in implementation on `feat/advisory-modes`.

## Why

Three things are wrong with how a teacher's role and advisory load are decided today.

1. **Whether someone is a volunteer is asked twice.** The create-account form has an
   "I am a Non-DepEd ARAL Volunteer" checkbox, and the profiling wizard asks for a
   designation that includes the same answer. 288 people ticked the box; only 107
   finished as volunteers. The designation is the authority
   (`isAralVolunteerDesignation`); the checkbox is noise.
2. **Floating is inferred, not declared.** A teacher with zero live sections is shown as
   Floating (`FLOATING_CHIP_LABEL`). That cannot tell "this teacher will not handle a
   class" from "the School Head has not assigned one yet", and the owner wants Floating
   to switch off the class-bound menus the way the volunteer designation does.
3. **The advisory cap is global.** `MAX_ADVISORY_SECTIONS = 3` applies to every teacher.
   The owner wants one teacher, one advisory by default, with up to three only for a
   teacher declared multi-grade.

And one live bug this design closes: the wizard offers volunteers an *optional* grade
and section picker, and picking one makes them the section's adviser. In production,
**23 volunteers in 15 schools hold 25 sections, none with a learner in it** — sections
that read as taken, so real teachers cannot pick them.

## Production shape (read-only queries, 2026-09-11)

| Fact | Count |
|---|---|
| Live TEACHER accounts with a profile, designation `Teacher` | 1100 |
| … `Non-DepEd ARAL Volunteer` | 107 |
| … `Master Teacher` | 52 |
| … custom "Others" text (`Teacher 1` ×2, `ARAL Coordinator` ×2, `Teacher 3`, `Teacher-IV`, blank) | 7 |
| Teachers mid-onboarding (no profile yet) | 609 |
| Teachers holding 2 or 3 live sections | 9 |
| Volunteers holding a live section (all empty) | 23 teachers / 25 sections / 0 learners |
| Profiled Teacher/Master Teacher holding zero sections | 27 |
| Sections with learners but no adviser | 2 sections / 14 learners |

## Decisions (owner)

| Question | Decision |
|---|---|
| Volunteer checkbox at sign-up | Removed. The profiling designation decides. |
| "Others" designation | **Kept**, with its free text. |
| "Others" assignment options | Same as Teacher. |
| Advisory setting | Two checkboxes for Teacher / Master Teacher / Others: **Floating teacher** and **Multi-grade advisory**. Mutually exclusive; both unticked = default. |
| Volunteer | Teaching assignment disabled. |
| Floating | DepEd teacher who handles no learners and no end-of-term reports. Sidebar rows disabled, labelled "Floating teacher". |
| Multi-grade | Up to 3 sections, any sections in any grades. |
| Who edits after profiling | **Teacher once (at profiling), then the School Head only.** |
| School Head controls | Can set a teacher's designation and advisory setting; the section picker adapts. |
| A change that drops held sections | **Confirm dialog** naming the sections, release on confirm. |
| Adviser-less sections | A reminder on the School Head's account for sections with learners but no adviser. |

## 1. Data model

```prisma
/// How many advisory sections a DepEd teacher may hold, as a declared setting.
/// Separate from `designation` (rank) on purpose: a Master Teacher may be floating.
/// Ignored for the Non-DepEd ARAL Volunteer designation, which never advises.
enum AdvisoryMode {
  DEFAULT      // exactly one advisory section
  FLOATING     // none: no class roster, no end-of-term reports; ARAL still open
  MULTI_GRADE  // one to three sections, any grades
}

model TeacherProfile {
  // …
  advisoryMode AdvisoryMode @default(DEFAULT)
}
```

On `TeacherProfile`, beside `designation`, because that is where the axis it qualifies
lives. A teacher with no profile has no designation either, so there is nothing for
a mode to qualify — the School Head's controls are unavailable for them (§4).

`Section.adviserId` stays authoritative for which sections a teacher holds. The mode
decides how many they **may** hold; it never stands in for the sections themselves.

### Caps — one pure function

`src/lib/teachers/advisory-limits.ts` (already its own module so client and server
can both import it) gains:

```ts
export function advisoryCapFor(designation: string | null | undefined, mode: AdvisoryMode): number
// Volunteer → 0 · FLOATING → 0 · DEFAULT → 1 · MULTI_GRADE → 3
```

`MAX_ADVISORY_SECTIONS` stays exported as the multi-grade ceiling (3) so existing
imports keep compiling; every cap *check* switches to `advisoryCapFor`.

`AdvisoryMode` labels go in `src/lib/constants/enum-labels.ts` (repo rule).

## 2. Sign-up

- `src/components/forms/login-form.tsx`: remove the "I am a Non-DepEd ARAL Volunteer"
  checkbox and its state.
- `src/lib/auth/teacher-registration.ts`: stop accepting `isAralVolunteer`; new rows get
  `registeredAsAralVolunteer = false` (the column default).
- The column is **kept**. The ~181 people who ticked it and have not finished profiling
  still get Volunteer pre-selected in the wizard — pre-selected, **not locked**. Today
  `volunteerWizard` locks the designation and hides a step; that lock is removed.

## 3. Profiling wizard (`src/components/forms/teacher-profile-form.tsx`)

**Designation** pills unchanged: Teacher · Master Teacher · Non-DepEd ARAL Volunteer · Others.

**Teaching Assignment step** is shown to everyone and never hidden:

- **Volunteer**: the card renders disabled with the reason ("Non-DepEd ARAL Volunteers
  don't take a teaching assignment. Your ARAL learners are assigned by your School
  Head."). No grade or section picker at all — this is what closes the 25-section bug.
- **Teacher / Master Teacher / Others**: the Yes/No "Do you advise a classroom section?"
  pills are replaced by two checkboxes, **Floating teacher** and **Multi-grade
  advisory**. Ticking one unticks the other.

| Mode | Picker | Required |
|---|---|---|
| DEFAULT | one grade + section | exactly 1 |
| FLOATING | hidden; explanatory note | none |
| MULTI_GRADE | up to 3 grade + section rows ("Add another section") | 1 to 3 |

Sections another teacher advises stay disabled in the picker, as today. The same section
cannot be picked twice.

**Edit mode (Settings → Profile)**: designation, advisory setting and sections render
read-only with "Ask your School Head to change this." The server enforces it (§5).

## 4. School Head — teachers page (`src/components/teachers-active-table.tsx`)

Per active, profiled teacher row:

- **Designation** control: Teacher / Master Teacher / Non-DepEd ARAL Volunteer / Others.
  Choosing Others asks for the text.
- **Advisory setting** control: Default / Floating / Multi-grade. Hidden when the
  designation is Volunteer.
- The section picker's limit is `advisoryCapFor(designation, mode)`; at the cap the add
  control is disabled with the reason ("Default teachers advise one section", "Floating
  teachers advise none", …).
- A teacher with no profile shows "Hasn't finished profiling" instead of the controls.
- The chip for a teacher with zero sections: **Floating** only when `mode = FLOATING`;
  **Unassigned** otherwise.

**A change that would drop held sections** (to Volunteer, to Floating, or Multi-grade →
Default while holding more than one) opens a confirm dialog naming the sections that will
be unassigned. Multi-grade → Default keeps the **first** section in the existing
`gradeLevel.type, name` order and releases the rest; the dialog says which stays. On
confirm, one action changes the setting and releases the sections in one transaction.

## 5. Server rules

New action `setTeacherAdvisorySetting(formData)` in `src/lib/actions/teacher.ts`:
`requireSchoolUser("SCHOOL_HEAD")` → Zod (`teacherId`, `designation`, `designationOther?`,
`advisoryMode`, `confirmRelease`) → load the teacher scoped to `user.schoolId` → compute
the sections that exceed the new cap → if any and `confirmRelease` is not set, return
`{ ok: false, error: "confirm_release", releases: [{ id, label }] }` — a result type
local to this action that widens the failure branch, the same sentinel-string precedent
as `createLearner`'s `"possible_duplicate"` → otherwise in one
`$transaction`: update `TeacherProfile.designation` / `advisoryMode`, release the excess
via `setTeacherAdvisory(…, { op: "remove" })` → `writeAudit` (new
`AUDIT_ACTIONS.TEACHER_ADVISORY_SETTING_CHANGE`, metadata: old/new designation, old/new
mode, released section ids) → revalidate with the existing teacher/school helpers.

`setTeacherAdvisory` (`src/lib/teachers/section-assignment.ts`) takes the cap from the
teacher's profile inside the transaction — `advisoryCapFor(profile.designation,
profile.advisoryMode)` — instead of the constant. `AdvisoryCapError` messages name the
mode's rule.

`saveTeacherProfile`:

- **First save** (no `TeacherProfile` row yet): accepts `designation`, `advisoryMode`,
  and `sectionIds[]`, validated against the mode (Volunteer and Floating: none; Default:
  exactly 1; Multi-grade: 1–3, distinct). Assigns them with `op: "add"` per section.
- **Later saves**: ignores `designation`, `advisoryMode` and sections from the client
  and keeps the stored values. Teacher once, then head only.
- `noAdvisorySection` is retired; `advisoryMode = FLOATING` replaces it.

`teacherProfileSchema` (`src/lib/validators/profile.schema.ts`) gains `advisoryMode`
and `sectionIds` (array, max 3) with the per-mode rules in `superRefine`.

## 6. Sidebar and access

- The teacher shell already reads `designation`; it also reads `advisoryMode`.
- `NavOptions` gains `isFloating`. When true, **Learners** and **End of Terms Reports**
  render inert with the pill **"Floating teacher"** (volunteers keep "DepEd only").
- `/teacher/learners` and the terms-reports pages refuse a Floating teacher on the same
  condition, showing `FLOATING_TEACHER_CARD` with its copy adjusted for a declared
  choice. Term-grade actions already require a live advisory, which a Floating teacher
  never has.
- Floating teachers and volunteers keep the ARAL Program (`aralTutorScope` never required
  an advisory).

## 7. The adviser-less reminder

A banner on the School Head dashboard and on the teachers page:
**"2 sections have learners but no adviser"** listing each (grade · section · learner
count) with a link to the teachers page. Query: sections in `user.schoolId`,
`deletedAt: null`, `adviserId: null`, with at least one learner whose `sectionId` is the
section and `deletedAt: null`. Cached with the school-dashboard tag and busted by the
same helpers that bust advisory changes. Hidden when the count is zero.

## 8. Migration `20260911000010_teacher_advisory_mode`

Numbered 010 to leave 005–009 free: `feat/error-handling` must renumber its
`20260911000003_add_error_event` (003 is taken in production) and will land in that gap.
Checked against `_prisma_migrations` immediately before applying.

Additive DDL, then two bounded data statements:

1. `CREATE TYPE "AdvisoryMode"` and `ALTER TABLE "TeacherProfile" ADD COLUMN
   "advisoryMode" "AdvisoryMode" NOT NULL DEFAULT 'DEFAULT'`. Every existing row lands on
   DEFAULT.
2. `UPDATE "TeacherProfile" SET "advisoryMode" = 'MULTI_GRADE'` where the teacher holds
   two or more live sections. Expected 9. Nobody loses a section.
3. `UPDATE "Section" SET "adviserId" = NULL` where the adviser's designation is
   `Non-DepEd ARAL Volunteer` **and** the section has no live learner. Expected 25. The
   zero-learner predicate means no roster changes hands. The legacy mirror
   (`User.advisorySectionId`, `TeacherSection`) is cleared for the same rows.

The 27 Teacher/Master Teacher accounts with no section become DEFAULT, not FLOATING:
Floating now switches off two menus, so it is declared rather than inferred. They show
as **Unassigned**.

**Apply before the code deploys.** The generated client names `advisoryMode` on every
`TeacherProfile` read, so code first would P2022 profiling and the teachers page.
Applied first, the column is invisible to the running code.

## 9. Testing

- `advisoryCapFor`: every designation × mode.
- `teacherProfileSchema`: per-mode section counts, duplicate sections, Volunteer with a
  section refused, Floating with a section refused.
- `saveTeacherProfile`: first save assigns per mode; a later save cannot change
  designation, mode or sections.
- `setTeacherAdvisorySetting`: `confirm_release` returned with section names; confirmed
  release in one transaction; tenancy (a teacher in another school → "Not found").
- `setTeacherAdvisory`: cap follows the profile.
- Nav: Floating → both rows inert with "Floating teacher"; volunteer unchanged.
- Wizard component: the two checkboxes exclude each other; Volunteer disables the card;
  Multi-grade allows three rows and no more.
- Migration: the three statements' predicates, run against a fixture.
- Four gates, then apply, then push.

## Out of scope

- Removing `registeredAsAralVolunteer` (a later cleanup, once no unprofiled account
  depends on the pre-selection).
- Remapping the seven "Others" values (kept by decision).
- Release notes for this change.
