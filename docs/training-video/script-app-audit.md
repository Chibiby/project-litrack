# Script ↔ app audit — ARAL LitTrack training videos

Checked `aral-training-video-script.md` and `screenshot-capture-checklist.md` against the app as
it exists on `main` today. Every finding below cites the file that decides the behaviour, so it
can be re-checked after any UI change.

**Verdict: do not record from the current script.** Fourteen of the twenty-one parts describe
screens, menu names, or fields that the app does not have. Three describe steps that are not
possible at all in the order the script gives them. The corrected script is
`aral-training-video-script-v2.md`; this file explains what changed and why.

**Part numbers in sections A to F below are v1's**, from the two-module script. v2 has three
modules and renumbers everything — see §G and `aral-recording-plan.md` for the current numbering.

---

## A. Blocking findings — the script asks for something impossible

### A1. The volunteer role does not exist at registration (Module 2 Parts 2 and 3)

Registration collects first name, middle name, last name, email, password and confirm password.
There is no role selector — `src/components/forms/login-form.tsx` has no volunteer or role
control anywhere in the register screen. A person becomes a Non-DepEd ARAL Volunteer by choosing
**Designation → Non-DepEd ARAL Volunteer** inside the teacher profiling wizard, which runs
*after* the School Head approves them (`src/components/forms/teacher-profile-form.tsx`,
`ARAL_VOLUNTEER_DESIGNATION` in `src/lib/validators/profile.schema.ts`).

Consequences:

- Module 2 Part 2's "choose Non-DepEd ARAL Volunteer as your role" cannot be filmed.
- Module 2 Part 3 tells the School Head to "check the role here — it should say Non-DepEd ARAL
  Volunteer" before approving. The pending table has columns Name, Email, Requested, Actions
  (`src/components/teachers-pending-table.tsx`). No role column exists, and the designation does
  not exist yet at that moment, so it could not be shown even if a column were added.
- Screenshots 17 (`17-vol-register.png`) and 8 (`08-approvals.png`) cannot be captured as
  specified.

**Resolution taken in v2:** the volunteer declares themself in the profiling wizard, and the
School Head is told to verify the person out of band — by name and email against the list of
volunteers the school actually recruited — because that is the only information the approval
screen has. Screenshot 17 is re-pointed at the profiling wizard's Designation step; screenshot 8
drops the role column from its requirement.

If verifying at approval time is a real requirement, that is a product change, not a script fix:
the designation would have to move into registration. Flagged, not assumed.

### A2. Learners have no LRN, and no grade or section is entered (Module 1 Part 10)

The script says "enter the LRN, the grade level, and the section" and warns that one wrong LRN
digit breaks the match with the enrolment list. There is no LRN field on the learner form and no
LRN column in the schema — `grep -i lrn` over `prisma/schema.prisma` and
`src/components/forms/learner-form.tsx` returns nothing.

Grade level and section are not entered either. A new learner is placed in the adding teacher's
advisory section automatically; `gradeLevelId` is set by the page, not chosen
(`src/components/forms/learner-form.tsx`). Moving a learner between sections is a School Head
transfer, and the form says so.

The form itself is far larger than the script implies: four collapsible sections with a
completion bar, covering name, age, gender, ethnicity, English and Filipino reading profiles
(with frustration subtypes), government benefits, parent education, transportation, distance
from home to school, and previous transfers.

**Resolution in v2** (now Module 2 Part 5): the script narrates the four sections and what each is for, states that grade
and section come from the advisory class, and drops the LRN line entirely. Runtime for the part
roughly triples.

### A3. ARAL is not a toggle on the learner record (Module 1 Part 11)

There is no ARAL toggle that reveals a tutor field. Enrolment happens in an **Enroll to ARAL**
sheet that takes an **ARAL tutor** first and then a multi-select list of learners
(`src/components/aral/enroll-to-aral-dialog.tsx`). The tutor dropdown offers **Myself** plus the
other eligible tutors. Re-assigning an already-enrolled learner is a separate **ARAL tutor**
dialog (`src/components/learners/assign-aral-tutor-dialog.tsx`).

**Resolution in v2** (now Module 2 Part 6): the script films the Enroll to ARAL sheet. Screenshot 13
(`13-aral-toggle.png`) becomes the sheet with a tutor chosen and learners ticked, and is renamed
in the checklist.

---

## B. Naming drift — the words on screen differ from the words in the script

| Script says | App shows | Source |
|---|---|---|
| "Enter your school head username" | No username field. School Head sign-in is school selection, then one field: **School ID or password** | `login-form.tsx:319–321` |
| "Create Account or Register link" | A **Teachers** button, then a **Sign in / Create account** toggle | `login-form.tsx:264–281, 355–395` |
| "Click School Profile in the menu" | School Head profiling is a forced 5-step wizard at `/school-head/profiling`, not a menu item | `src/app/school-head/(onboarding)/profiling/page.tsx` |
| "Grades and Sections" | **School → Grade levels** tab | `src/components/school-head/workspace-tabs.ts` |
| "Teacher Accounts / Pending Approvals" | **Teachers → Pending** tab | same file |
| "My Profile" (teacher) | Teacher profiling wizard, 5 steps | `teacher-profile-form.tsx:74–78` |
| "ARAL Attendance" | **Weekly Attendance**, under the ARAL Program group | `src/lib/nav/nav-config.ts:213` |
| "Reading Level" | **Monthly Reading Level** | `nav-config.ts:219` |
| "Click your name at top right, then Log Out" | **Sign out**, in the sidebar identity menu | `src/components/user-account-menu.tsx`, `sign-out-button.tsx` |
| "Log Out" | **Sign out** everywhere | same |

The School Head sidebar is: Dashboard · Manage (School, Teachers, ARAL Program, Transfer) ·
Records (Announcements, Reports, Audit). The teacher sidebar is: Menu (Dashboard, Learners, End
of Terms Reports) · ARAL Program (Weekly Attendance, Monthly Reading Level) · Reports.

---

## C. Part 4 was two different things — this is what resolves the stub

The recording plan flagged Part 4 as the one part with no runtime estimate. The cause is that
"school profiling" in the script conflates two separate screens:

1. **School Head profiling** (`/school-head/profiling`) — a five-step wizard about the *person*:
   Respondent Information (first, middle, last name, email, contact number, designation fixed to
   School Head, position), Professional Background (highest educational attainment, field of
   specialization, years in service), Training and Professional Development (reading trainings
   yes/no plus list, English curriculum trainings yes/no plus list, highest training level),
   School Structure (which grade levels the school has, sections per grade), and Review and
   Submit. This is the gate: `profileCompleted` is what unlocks the rest of the app.
2. **School information** (School → School information tab) — five editable fields plus a
   read-only School ID: school name, address, region, division, district
   (`src/components/school-head/school-info-form.tsx`).

Neither is a 15–20 field school profile form. Narrated step by step, the wizard is about
**2:30–3:00**, not the 3–4 minutes the plan budgeted, and the School information tab is under a
minute. v2 splits them into Module 1 Part 4 (the wizard) and Part 5 (School information), with real field
lists, so there is no longer a placeholder line anywhere in the script.

Note also that the School Structure step already asks which grade levels exist and how many
sections per grade, which overlaps the old Part 5. v2 keeps that part — now Module 1 Part 6 — but frames it as "confirm and name
what the wizard created", which is what actually happens on screen.

## D. The teachers-unlock claim needs one more condition

Part 4 says teacher accounts stay locked until school profiling is finished. The real condition
is a profiled School Head **and at least one grade level**:
`teachersOpen: s.users.length > 0 && s._count.gradeLevels > 0` in
`src/lib/actions/school.ts:266`. Until both hold, the **Teachers** button on the login page stays
disabled. v2 says both, in Module 1 Part 4 and again in Part 6, because a school head who stops after the
wizard will report the system as broken.

## E. Part 3, the password recommendation

The recording plan already raised this. Confirmed against the app: **Skip for now** exists on the
set-password screen and keeps the current credential
(`src/components/forms/password-form.tsx:273–300`). V2 demonstrates changing the password and
mentions that Skip exists, rather than the reverse — teachers copy what they see. The screen also
tells them where to change it later (Settings → Security), which is worth saying out loud.

## F. Weekly Attendance and Monthly Reading Level are grids, not per-learner forms

Part 12 and Part 13 describe selecting a learner and then filling a field. Both screens are grids
covering every ARAL learner at once — attendance by weekday
(`aral-weekly-attendance-grid-form.tsx`), reading level by month
(`aral-monthly-reading-level-grid-form.tsx`). Weekends and grade-level holidays are locked cells
that cannot take a mark. V2 narrates the grid, which is also the more useful thing to teach.

Screenshot 16 asked for an open level dropdown on a per-learner screen; in v2 it is an open level
cell in the monthly grid.

---

## F2. The tutor dropdown does not require a completed profile

Module 2 Part 5 — the volunteer module, now Module 3 Part 5 — tells teachers that "only volunteers who are approved **and** have completed
their profile will appear here", and offers that as the explanation when a volunteer is missing
from the list. The eligibility rule is approval and nothing else:
`aralTutorScope` in `src/lib/teachers/aral-tutor.ts` filters on `role: "TEACHER"`,
`isActive: true`, `approvalStatus: "APPROVED"` and `deletedAt: null`. The comment above it is
explicit that any teacher at the school qualifies, plantilla or not, advisory or not. The DepEd /
Non-DepEd chip beside each name is display only and never narrows the list.

So a volunteer who is approved but has not touched their profiling wizard **does** appear in the
dropdown, under whatever name registration captured, with no chip. V2 says approval is the only
requirement, and keeps the "complete your profile" instruction in the volunteer profiling part (now Module 3 Part 4) on its real
grounds — the profiling gate blocks the volunteer's own access to the app, not the teacher's
ability to assign to them.

This also weakens the story in what is now Module 3 Part 6 a little: the volunteer can be assigned learners
before profiling. V2 orders it the same way regardless, because completing the profile first is
still the behaviour to teach.

## G. What this does to the runtime

Counted from v2 at 125 wpm; per-part figures are in `aral-recording-plan.md`.

**Module 1 has been split**, at the seam between the School Head's one-time setup and the
teacher's ongoing job. Three modules now:

| | Old estimate | v2 |
|---|---|---|
| Module 1 — School Heads | — | 9:58 (1,245 words) · ~12–14 min with holds |
| Module 2 — Teachers | — | 12:22 (1,546 words) · ~15–17 min with holds |
| *(the two together)* | *11:52, Part 4 a placeholder* | *22:20* |
| Module 3 — Volunteers | 5:51 | 6:34 (820 words) · ~8–9 min with holds |

Most of the growth over v1 is real work the v1 script did not describe: the two profiling wizards
and the learner form are 755 words between them, and none of it was in the old count. The split
itself added about three minutes on top — each new module carries its own opening and closing,
and Modules 2 and 3 re-teach opening the site and choosing the district and school so they stand
alone.

The seam is clean because the two audiences barely overlap. A school head does Module 1 once per
school and then only ever approves accounts. A teacher never does any of it. Every part was
already a separate take with its own chapter marker, so the split changed how takes are grouped
in the edit, not how they are recorded — the recording order is still one continuous build of
account state from an empty school to an assigned volunteer.

## H. Still unverified

These need a live demo tenant to confirm and could not be settled from the code alone:

- The exact confirmation copy after each save.
- What the volunteer dashboard renders with zero assigned learners — screenshot 18 needs it to be
  a recognisable empty state.
