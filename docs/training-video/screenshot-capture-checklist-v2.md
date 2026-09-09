# Screenshot capture checklist v2 — ARAL LitTrack User Manual

Nineteen screens, named exactly as shown. Corrected against the app: five entries in v1 named a
screen that does not exist. What changed and why is in `script-app-audit.md`.

Every screen here occurs inside the walkthrough in `aral-training-video-script-v2.md`, so record
the video first and pull these as frames rather than running a separate screenshot session.

## Before you start
- Browser at **1920×1080**, zoom **100%**. Do not resize between captures.
- Sign in at **arallitrack.com** using demo accounts only.
- **No real learner names or grades.** Use: Ana Reyes, Ben Cruz, Carla Lim.
- Turn off password manager, autofill, and notifications.
- Capture the **full browser window**, consistently across all 19.
- PNG preferred. JPG is fine.

## The list

| # | Filename | What to capture | Comes from |
|---|----------|-----------------|-----------|
| 1 | `01-landing.png` | The sign-in page, with District and School Name filled and the Teachers / School Head buttons visible | M1 P2 |
| 2 | `02-signin.png` | The School Head sign-in panel — one password field, dots only, never plaintext | M1 P3 |
| 3 | `03-set-password.png` | The set-password screen after first sign in, with both password fields and the Skip for now button visible | M1 P3 |
| 4 | `04-sh-profiling.png` | School Head profiling, step 1 Respondent Information, partly filled, step bar visible at top | M1 P4 |
| 5 | `05-grade-sections.png` | School → Grade levels, with one grade card expanded and one saved section in its list | M1 P6 |
| 6 | `06-register.png` | The Create account form, with the Sign in / Create account toggle visible above it | M2 P2 |
| 7 | `07-pending.png` | The "Awaiting approval" screen after creating an account | M2 P2 |
| 8 | `08-approvals.png` | Teachers → Pending, showing the Name / Email / Requested columns and the Approve button | M2 P3 |
| 9 | `09-teacher-dash.png` | The teacher dashboard after sign in, full sidebar visible including the ARAL Program group | M2 P4 |
| 10 | `10-teaching-assignment.png` | Teacher profiling, step 3 Teaching Assignment, with the Section field visible | M2 P4 |
| 11 | `11-add-learner.png` | The Add learner dialog, first section filled with sample data, completion bar visible | M2 P5 |
| 12 | `12-learner-list.png` | The class list showing the three sample learners | M2 P5 |
| 13 | `13-enroll-aral.png` | The "Enroll Ana Reyes in ARAL" dialog with a tutor chosen | M2 P6 |
| 14 | `14-tutor-dropdown.png` | The ARAL tutor dropdown **open**, showing Myself and at least one other tutor with their DepEd / Non-DepEd chip | M3 P5 |
| 15 | `15-attendance.png` | The weekly attendance grid, week selector legible at the top | M2 P7 |
| 16 | `16-reading-level.png` | The monthly reading level grid with a level cell **open** | M2 P8 |
| 17 | `17-vol-designation.png` | Teacher profiling step 1 with Designation set to **Non-DepEd ARAL Volunteer** | M3 P4 |
| 18 | `18-vol-empty.png` | The volunteer's Weekly Attendance with **no** learners yet | M3 P4 |
| 19 | `19-vol-assigned.png` | The same screen **after** Ana has been assigned | M3 P6 |

## What changed from v1

| # | v1 asked for | Why it changed |
|---|---|---|
| 2 | "login screen" | There is no username field; the School Head panel is one password box. Renamed `02-login` → `02-signin`. |
| 3 | "change-password prompt" | The screen is a set-password screen with Skip for now. Renamed. |
| 4 | "school profile form, top portion" | No such form. The gate is the School Head profiling wizard; School information is a separate five-field tab. Repointed and renamed. |
| 6 | "role selector visible" | Registration has no role selector. Now the Sign in / Create account toggle. |
| 8 | "role column" | The pending table has no role column, and the designation does not exist yet at approval time. Requirement dropped. |
| 10 | "My Profile, advisory class field" | It is step 3 of the profiling wizard, Teaching Assignment. Renamed. |
| 13 | "ARAL setting turned on, tutor field revealed" | There is no toggle. Enrolment is a dialog that takes the tutor. Renamed `13-aral-toggle` → `13-enroll-aral`. |
| 17 | "registration form with volunteer role selected" | The designation is set in profiling, after approval. Renamed and repointed to M3 P4. |
| 18–19 | "volunteer dashboard learner list" | Volunteers have no Learners roster — it shows as DepEd only. Their learners appear in Weekly Attendance. Repointed. |

## Notes
- For #14 and #16 the dropdown or cell must be **open** in the capture. A closed control does not
  show teachers what their options are, which is the whole point of those screens.
- #14 is pulled from Module 3 Part 5, not Module 2 Part 6, because that is the only take where
  both a teacher and a volunteer are in the list. Module 2 Part 6 happens before Rosa exists.
- For #15, make sure the week selector is legible. Choosing the wrong week is the most common
  mistake in the system.
- Send the stills clean, with no annotations. The manual adds captions.
