# ARAL LitTrack — recording plan (v2)

Built on `aral-training-video-script-v2.md` and `screenshot-capture-checklist-v2.md`. The v1 plan
was built on a script that described screens the app does not have; see `script-app-audit.md`.

**Three modules:** Module 1 for school heads, Module 2 for teachers, Module 3 for non-DepEd ARAL
volunteers. One OBS take per Part.

**Record in the order below, across all three modules in one sitting.** The order follows the
account state the system actually builds up — a school head must exist before a teacher can
register, a teacher before a volunteer can be assigned a learner — so you never have to fake or
reset anything. The modules are separated in the *edit*, not on the day.

**Locked settings for every take:** browser 1920×1080, zoom 100%, address bar history
cleared, password manager / autofill / notifications / extensions off. Demo accounts only.
Learners: Ana Reyes, Ben Cruz, Carla Lim. Never resize between takes — the screenshot
checklist and the video share the same frames.

---

## Screenshot ↔ script mapping

All 19 checklist screens occur inside the walkthrough. Record first, pull stills after.

| # | Filename | Comes from | Must show |
|---|----------|-----------|-----------|
| 1 | `01-landing.png` | M1 P2 | District + School Name filled, both role buttons |
| 2 | `02-signin.png` | M1 P3 | School Head panel — password field, dots only |
| 3 | `03-set-password.png` | M1 P3 | Both password fields + Skip for now |
| 4 | `04-sh-profiling.png` | M1 P4 | Step 1, partly filled, step bar visible |
| 5 | `05-grade-sections.png` | M1 P6 | One saved section inside a grade card |
| 6 | `06-register.png` | M2 P2 | Sign in / Create account toggle above the form |
| 7 | `07-pending.png` | M2 P2 | Awaiting approval screen |
| 8 | `08-approvals.png` | M2 P3 | Pending table + Approve button |
| 9 | `09-teacher-dash.png` | M2 P4 | Full sidebar incl. ARAL Program group |
| 10 | `10-teaching-assignment.png` | M2 P4 | Step 3, Section field visible |
| 11 | `11-add-learner.png` | M2 P5 | Form filled, completion bar visible |
| 12 | `12-learner-list.png` | M2 P5 | All three sample learners |
| 13 | `13-enroll-aral.png` | M2 P6 | Enroll dialog with a tutor chosen |
| 14 | `14-tutor-dropdown.png` | **M3 P5** | **Dropdown open** — Myself + Rosa with Non-DepEd chip |
| 15 | `15-attendance.png` | M2 P7 | Week selector legible at top |
| 16 | `16-reading-level.png` | M2 P8 | **Level cell open** |
| 17 | `17-vol-designation.png` | M3 P4 | Designation = Non-DepEd ARAL Volunteer |
| 18 | `18-vol-empty.png` | M3 P4 | Weekly Attendance, no learners |
| 19 | `19-vol-assigned.png` | M3 P6 | Same screen, Ana present |

**Ordering catch, resolved:** #14 needs both a teacher and a volunteer in the tutor list, and
Module 2 Part 6 happens before Rosa exists. v2 pulls #14 from Module 3 Part 5 instead — that take
has both options open by design. Do not try to reorder Module 2 for it.

---

## Take order and account state

Record top to bottom. The module boundaries are edit-time cuts, not breaks in the state.

### Module 1 — For School Heads

| Take | Signed in as | State needed before rolling |
|---|---|---|
| M1 P1 | — | Title card / blank desktop |
| M1 P2 | signed out | Fresh tab, address bar cleared, **Teachers button still greyed out** |
| M1 P3 | school head, 1st sign in | Password still = School ID, never changed |
| M1 P4 | school head | Profiling wizard never submitted |
| M1 P5 | school head | School information tab not yet saved |
| M1 P6 | school head | Grade levels exist from the wizard, no sections named yet |
| M1 P7 | school head → signed out | Grade levels and sections done, so the Teachers button now enables on the way out |

### Module 2 — For Teachers

| Take | Signed in as | State needed before rolling |
|---|---|---|
| M2 P1 | — | Title card |
| M2 P2 | signed out | Juan dela Cruz does **not** exist yet; Teachers button now enabled |
| M2 P3 | school head | Juan pending approval |
| M2 P4 | Juan (teacher) | Just approved, profiling wizard never submitted |
| M2 P5 | Juan | Learner list empty |
| M2 P6 | Juan | Ana exists, not yet in ARAL |
| M2 P7 | Juan | Ana in ARAL with a tutor |
| M2 P8 | Juan | Ana in ARAL |
| M2 P9 | Juan | — |

### Module 3 — For Non-DepEd ARAL Volunteers

| Take | Signed in as | State needed before rolling |
|---|---|---|
| M3 P1 | — | Title card |
| M3 P2 | signed out | Rosa Mendoza does **not** exist yet |
| M3 P3 | school head | Rosa pending approval |
| M3 P4 | Rosa (volunteer) | Approved, profiling wizard never submitted, no learners assigned |
| M3 P5 | Juan | Rosa approved (profiling not required for her to appear in the list) |
| M3 P6 | Rosa | Ana assigned to Rosa |
| M3 P7 | Rosa | — |

### One-shot takes — plan a spare account

Six takes cannot be re-rolled on the same account, because the state they show only exists once:

- **M1 P3** — the School ID password and the set-password screen. Gone after the first sign in.
- **M1 P4** — the School Head profiling wizard, blank. Gone after submit.
- **M2 P2** and **M3 P2** — the account must not exist yet.
- **M2 P4** and **M3 P4** — the teacher and volunteer profiling wizards, blank. Gone after submit.

Fluffing any of these means a fresh demo account for the retake. The demo tenant has three demo
schools under the demo district, so you have room — but decide up front which school is the spare
and do not burn all three on the first pass.

---

## Narration timing per part

Counted from the v2 script at 125 wpm. Screen action runs longer than the words in almost every
part; treat these as floors, not targets.

### Module 1 — For School Heads

| Part | Words | Narration |
|---|---|---|
| 1 — Opening and Overview | 154 | 1:14 |
| 2 — Opening the Site, District, School | 206 | 1:39 |
| 3 — School Head First Sign In | 186 | 1:29 |
| 4 — School Head Profiling | 286 | 2:17 |
| 5 — School Information | 84 | 0:40 |
| 6 — Grade Levels and Sections | 182 | 1:27 |
| 7 — Signing Out and Closing | 147 | 1:11 |
| **Total** | **1,245** | **9:58** |

With holds and form-filling: **~12–14 minutes**.

### Module 2 — For Teachers

| Part | Words | Narration |
|---|---|---|
| 1 — Opening | 111 | 0:53 |
| 2 — Creating Your Teacher Account | 286 | 2:17 |
| 3 — School Head Approves the Teacher | 134 | 1:04 *(2× in edit)* |
| 4 — Teacher Signs In / Profiling | 215 | 1:43 |
| 5 — Adding Learners | 268 | 2:09 *(learner 2 and 3 at 2× in edit)* |
| 6 — Enrolling in ARAL / Assigning a Tutor | 167 | 1:20 |
| 7 — Weekly Attendance | 129 | 1:02 |
| 8 — Monthly Reading Level | 109 | 0:52 |
| 9 — Closing | 127 | 1:01 |
| **Total** | **1,546** | **12:22** |

With holds and form-filling: **~15–17 minutes**.

### Module 3 — Non-DepEd ARAL Volunteers

| Part | Words | Narration |
|---|---|---|
| 1 — Opening | 61 | 0:29 |
| 2 — Volunteer Creates an Account | 124 | 1:00 |
| 3 — School Head Approves the Volunteer | 101 | 0:48 *(2× in edit)* |
| 4 — Volunteer Signs In / Profiling | 200 | 1:36 |
| 5 — Teacher Assigns a Learner | 148 | 1:11 |
| 6 — Volunteer Manages ARAL Learners | 114 | 0:55 |
| 7 — Closing | 72 | 0:35 |
| **Total** | **820** | **6:34** |

With holds: **~8–9 minutes**.

**All three: 3,611 words, 28:53 of narration, ~35–40 minutes of finished video.** That is about
six minutes more than the unsplit version, which is the cost of each module standing alone —
Module 2 and Module 3 re-teach opening the site and picking the district and school, and each
module carries its own opening and closing.

---

## Post-record checklist

- [ ] 23 takes captured (7 + 9 + 7)
- [ ] 19 stills pulled from footage, named exactly per the v2 checklist
- [ ] No real learner names or grades in any frame
- [ ] Password fields show dots only, everywhere
- [ ] #14 dropdown and #16 level cell are **open**
- [ ] #15 week selector is legible
- [ ] #17 shows Designation set to Non-DepEd ARAL Volunteer
- [ ] Stills are clean — no annotations (captions get added later)
