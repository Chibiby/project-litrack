# PROJECT LITRACK — Requirements Traceability Matrix

Source of truth: `EDITED-Learner-Profiling-Survey-and-SH-and-Teachers.docx` (extracted to `docs-source-requirements.txt`).
Status legend: `TBD` (not yet audited), `MISSING`, `PARTIAL`, `DONE`, `VERIFIED` (done + reviewed + tested).

Each requirement maps to: Prisma model/enum · migration · validation schema · server action/API · form/UI · authorization · report/dashboard usage · tests · status.

## 1. Learner Profiling Survey

### 1.A Learner Information (initial profiling, required before/at learner creation)
| ID | Requirement | Details | Status |
|----|-------------|---------|--------|
| L-A1 | Name | Free text (First, Middle, Last per workflow notes) | VERIFIED — Prisma Learner.first/middle/lastName; Zod learnerCreate/UpdateSchema; LearnerForm; createLearner/updateLearner; unit tests |
| L-A2 | Age | Numeric, constrained range | VERIFIED — age 3–25 coerce int; form min/max; tests |
| L-A3 | Gender | Male / Female | VERIFIED — Gender enum MALE/FEMALE; FieldRadioGroup; tests |
| L-A4 | Reading Level Profile in English | Options: Non-Decoder/Low Emergent; Frustration/High Emergent; If frustration → Problem in Decoding; If frustration → Problem in Comprehension (all levels); If frustration → Problem in Comprehension (Critical only); Instructional/Developing or Transitioning; Independent/Grade level Ready. Conditional: frustration sub-options only when Frustration selected. | VERIFIED — ReadingProfile + FrustrationSubtype enums; Zod superRefine clears/rejects subtypes unless FRUSTRATION_HIGH_EMERGENT; LearnerForm shows subtypes only when Frustration selected (client+server) |
| L-A5 | Reading Level Profile in Filipino | Same option set and conditional rule as L-A4 | VERIFIED — same as L-A4 for filipino* fields |
| L-A6 | Government Benefits Received | Multi-select: 4Ps; IPs | VERIFIED — GovernmentBenefit FOUR_PS/IPS; FieldCheckboxList; tests |
| L-A7 | Parents’ Educational Background | No formal Education; Elementary Level; Elementary Graduate; Secondary Level; Secondary Graduate; College Level; College Graduate | VERIFIED — ParentEducation enum + labels; FieldRadioGroup; tests |

### 1.B Attendance and School Background (ARAL additional profiling)
| ID | Requirement | Details | Status |
|----|-------------|---------|--------|
| L-B1 | Mode of Transportation | Walking; Motorcycle; Bus/Jeep/Car | VERIFIED — ModeOfTransportation; aralProfileSchema; AralUpdateForm |
| L-B2 | Distance of Home to School | Less than 1 km; 1–5 km; More than 5 km | VERIFIED — DistanceHomeToSchool; schema+form |
| L-B3 | Previous School Transfers | No transfers; 1 transfer; Multiple transfers (Specify: ___ required when selected) | VERIFIED — previousTransfers + transferDetails refine (required iff MULTIPLE); UI shows Specify only when Multiple |

### 1.C Reading Behavior (Letter-to-Word Recognition Level)
| ID | Requirement | Details | Status |
|----|-------------|---------|--------|
| L-C1 | Frequency of Absenteeism | 1–3 days/month; 3–5 days/month; More than 5 days/month; Consistently absent every week. Specify reason (free text) accompanies selection. | VERIFIED — AbsenteeismFrequency (+ OTHER retained for compat); absenteeismOtherReason required always (DOCX); unit tests |
| L-C2 | Letter Recognition | Recognizes all letters with ease; Confuses similar-looking letters (e.g., b/d, p/q, m/n); Struggles to recall letter names; N/A | VERIFIED — LetterRecognition enum + labels |
| L-C3 | Letter-Sound Correspondence | Accurately connects letters to sounds; Inconsistently identifies letter sounds; Unable to associate letters with sounds; N/A | VERIFIED — LetterSoundCorrespondence |
| L-C4 | Word Recognition | Reads high-frequency words fluently; Relies on guessing rather than decoding; Omits, adds, or replaces letters in words; Struggles to recognize common sight words; N/A | VERIFIED — WordRecognition |

### 1.D External Factors Affecting Reading Progress
| ID | Requirement | Details | Status |
|----|-------------|---------|--------|
| L-D1 | Home Literacy Environment | Has access to books and reading materials; Limited exposure to books at home; No reading materials available; N/A | VERIFIED — HomeLiteracyEnvironment |
| L-D2 | Parental Support | Parents/guardians regularly assist with reading; Parents/guardians have limited involvement; No support available at home; N/A | VERIFIED — ParentalSupport |
| L-D3 | Classroom Learning Environment | Small class size (individualized attention possible); Large class size (limited teacher attention); N/A | VERIFIED — ClassroomEnvironment |
| L-D4 | Language Considerations | Primary language at home matches the language of instruction; Learner speaks a different dialect/language at home; Struggles with language transition in school; N/A | VERIFIED — LanguageConsideration multi-select |

### 1.E Suggested Interventions and Recommendations
| ID | Requirement | Details | Status |
|----|-------------|---------|--------|
| L-E1 | Suggested Reading Interventions | Multi-select: Phonemic awareness activities; Letter-sound correspondence drills; Sight word recognition practice; Structured phonics instruction; One-on-one reading support; Home reading program; Need for Other Intervention due to Manifestation for being LSENs (Specify Observations ___ required when selected) | VERIFIED — suggestedInterventions + lsenObservations refine (required iff LSEN_OTHER); UI gated |
| L-E2 | Recommendation for Further Assessment | MFAT (Multifactor Assessment Tool); Other (Specify ___ required when selected) | VERIFIED — furtherAssessment + furtherAssessmentOther refine; UI gated |

### 1.F ARAL designation
| ID | Requirement | Details | Status |
|----|-------------|---------|--------|
| L-F1 | “ARAL LEARNER” action per learner | Teacher marks learner as ARAL → learner appears in per-grade-level ARAL dashboard | VERIFIED — toggleAralLearner; isAralLearner; ARAL routes |
| L-F2 | ARAL Dashboard per grade level | Lists enrolled ARAL learners; per learner “UPDATE DATA” button | VERIFIED — `/teacher/aral/[gradeId]` |
| L-F3 | UPDATE DATA = additional profiling | ARAL Sections B–E captured via update workflow | VERIFIED — saveAralProfile + AralUpdateForm (violet sections) |
| L-F4 | Default ARAL tracking | Attendance per week; Reading Level per month | VERIFIED — Attendance.weekStart; ReadingLevelRecord.monthYear |

## 2. Teacher and School Head Profiling Survey

### 2.I Respondent Information
| ID | Requirement | Details | Status |
|----|-------------|---------|--------|
| P-I1 | Name (Optional) | Free text, explicitly optional | VERIFIED — SH form edits user name; Teacher name from invite; designation optional |
| P-I2 | Designation | Teacher; Master Teacher; School Head; Others (Specify ___) | VERIFIED — UI radio + Others specify → designation string (no schema migration); stored on profile |
| P-I3 | Contact Number | Free text/phone | VERIFIED — contactNumber optionalText |
| P-I4 | Email Address | Email format | VERIFIED — login `User.email` shown read-only on Teacher/SH profiling forms; optional survey `contactEmail` on TeacherProfile/SchoolHeadProfile (Zod email); offline migration `20260806000003_profile_contact_email`; save via saveTeacherProfile/saveSchoolHeadProfile; synthetic login emails never overwritten; unit tests |
| P-I5 | Position (Teachers) | Teacher I–VII; Master Teacher I–IV (shown for teacher-type designations) | VERIFIED — TEACHER_POSITION enum + TeacherProfileForm |
| P-I6 | Position (School Head) | Teacher I–V (TIC); Head Teacher I–VII; Principal I–IV; TECHVOC Ad (shown for School Head) | VERIFIED — SH_POSITION + SchoolHeadProfileForm |

### 2.II Professional Background
| ID | Requirement | Details | Status |
|----|-------------|---------|--------|
| P-II1 | Highest Educational Attainment | Bachelor’s Degree; With Master’s Units; Master’s Degree; With Doctoral Units; Doctoral Degree | VERIFIED — EducationalAttainment |
| P-II2 | Field of Specialization | General Education; English; Math; Science; Filipino; TLE/EPP; ARALPAN; MAPEH; TechVoc; Values Ed; Others (Specify ___) | VERIFIED — specializationOther required iff OTHERS (Zod+UI) |
| P-II3 | Years in Service | 0–3; 4–10; 11–20; 21 and above | VERIFIED — YearsInService |
| P-II4 | Current Grade Level / Assignment (Teachers) | Kinder; Grades 1–12 | VERIFIED — currentGradeAssignment (includes FLOATING for platform parity) |

### 2.III Teaching Assignment
| ID | Requirement | Details | Status |
|----|-------------|---------|--------|
| P-III1 | Most Subject Currently Handled (if Teacher) | English; Math; Science; Filipino; TLE/EPP; ARALPAN; MAPEH; TechVoc; Values Ed; ABM | VERIFIED — mostSubjectHandled required on teacherProfileSchema |

### 2.IV Training and Professional Development
| ID | Requirement | Details | Status |
|----|-------------|---------|--------|
| P-IV1 | Attended literacy/reading trainings? | Yes / No | VERIFIED — hasReadingTraining boolean |
| P-IV2 | Recent reading trainings (last 5 years) | ARAL; Teaching Reading; ELLN; TEACEP; None at all (multi-select; conditional on P-IV1) | VERIFIED — arrays required when Yes, empty when No; NONE exclusivity; UI gated |
| P-IV3 | Attended English Curriculum Instruction trainings? | Yes / No | VERIFIED — hasEnglishTraining |
| P-IV4 | Recent English Curriculum trainings (last 5 years) | Matatag Training; Upskilling of English Competence; None at all (conditional on P-IV3) | VERIFIED — same pattern as P-IV2 |
| P-IV5 | Highest level of trainings attended (last 5 years) | International; National; Region; Division; District; School; N/A | VERIFIED — TrainingLevel |

## 3. Workflow Requirements (DOCX login/activation notes)
| ID | Requirement | Details | Status |
|----|-------------|---------|--------|
| W-1 | School selection at login | Select School Name at login. DOCX says School ID as password — overridden by security priority: private password / one-time activation credential instead. | DONE (activation credential + mustChangePassword; School ID is identifier only) |
| W-2 | Role entry points gated | School Head must activate first; Teacher entry disabled until School Head profiled + grade levels created + teachers added | VERIFIED — listSchoolsWithTeacherStatus requires profiled SH + grades + teachers; LoginForm disables Teachers button |
| W-3 | School Head profiling gate | School Head completes profiling survey before “Create Grade Level” unlocks | DONE (`createGradeLevel` requires `profileCompleted`) |
| W-4 | Grade level creation | Kinder, Grades 1–12, Floating | DONE (`GradeLevelType` KINDER/G1–G12/FLOATING; `createGradeLevel`) |
| W-5 | Add teachers within grade level | Full name: First, Middle, Last | VERIFIED — InviteTeacherForm first/middle/last; teacherInviteSchema |
| W-6 | Teacher sees assigned grade levels | On login, sees grade levels created by School Head; enters assigned one | VERIFIED — `/teacher` assigned grades + sidebar |
| W-7 | Teacher profiling gate | Teacher cannot add learners until own profiling completed | DONE (`createLearner` requires `profileCompleted`) |
| W-8 | Learner added one-by-one with profiling | Section A at creation | VERIFIED — LearnerForm Section A on create |
| W-9 | ARAL button → ARAL dashboard per grade level | See L-F1..F4 | VERIFIED |
| W-10 | Attendance per week + Reading level per month defaults | ARAL tracking cadence | VERIFIED — attendance + reading-level actions/forms |

## 4. Platform Requirements (mandate beyond DOCX)
Authentication/accounts (AUTH-*), Super Admin management (SA-*), School Head management (SH-*), Teacher features (T-*), learner lifecycle (LM-*), import/export (IO-*), audit (AUD-*), dashboards (DB-*), security (SEC-*), production readiness (PR-*), quality gates (QG-*). Detailed rows to be expanded during backlog creation; tracked in `docs/backlog.md`.

## Discovery summary (repo audit, Aug 6 2026)

- Survey rows L-A*..P-IV* and W-2/W-5/W-6/W-8 upgraded to **VERIFIED** after field-by-field DOCX check, Zod conditional refinements, UI gating, and unit tests (Wave 3 V2).
- **P-I4 VERIFIED:** account email read-only + `contactEmail` on TeacherProfile/SchoolHeadProfile (migration `20260806000003`); synthetic login emails preserved.
- Cross-school learner transfer (Super Admin): `transferLearnerCrossSchool` + `/admin/transfers`; audit `LEARNER_TRANSFER_CROSS_SCHOOL`.
- DB3: role dashboards use real Prisma aggregates + Recharts; empty states with CTAs.
- IO3: CSV learner import (grade-scoped wizard, Zod, valid-rows commit); Excel + printable reports for Teacher/School Head; export/import audits. Tenant isolation enforced.
- T3/DOC3: expanded unit tests; docs corrected to Next 14 / React 18 + activation credential / teacher invite; deployment/runbook/privacy + `docs/migrate-checklist.md`.
- Platform (Wave 2 S2/SA2): School Head school-year / sections / school info / announcements / audit / transfer; Super Admin profile / audit / school-year oversight / school activate-deactivate / cross-school transfers. Migrations committed offline only — remote apply still requires user approval.

Full backlog and worker assignments: `docs/backlog.md`.

---
_Last updated: post-conditional-pass gap close (Aug 6 2026)._
