import { Sparkles } from "lucide-react";

/**
 * What a DepEd teacher with no advisory section sees where a roster would be.
 *
 * §5 of the ten concerns. `teacherAdvisoryGradeScope` matches nothing for such a
 * teacher, so every advisory surface rendered an empty table — which reads as
 * broken data rather than as an accurate description of their situation. The
 * table was telling the truth; it just had no way to say so.
 *
 * Shared for the same reason `TERM_SHEET_NO_ADVISORY_CARD` and
 * `NO_ADVISORY_MESSAGE` are: a teacher who meets this on the dashboard and then
 * opens the roster must not get a second, differently-worded account of one
 * situation.
 *
 * Deliberately NOT the volunteer copy. A Non-DepEd ARAL Volunteer holds no
 * classroom role at all and never will; a floating DepEd teacher holds one and
 * has no section yet. Telling the second they are the first would be wrong, and
 * would leave them with no idea what to ask their School Head for.
 *
 * It points at ARAL because that is the surface a floating teacher CAN reach —
 * `aralTutorScope` has never required an advisory, which is what makes an
 * ARAL-only teacher work at all.
 */
export const FLOATING_TEACHER_CARD = {
  icon: Sparkles,
  title: "No advisory section yet",
  description:
    "You don't advise a section, so there is no class roster here. Ask your School Head to assign you one and this page will fill in. Learners you tutor for ARAL are in the ARAL Program, which does not need an advisory section.",
  actionHref: "/teacher/aral",
  actionLabel: "Go to ARAL Program",
} as const;

/** The chip the School Head's teachers table shows in place of a blank cell. */
export const FLOATING_CHIP_LABEL = "Floating";

/**
 * What a DepEd teacher SET to Floating sees where a class roster or the end-of-
 * term sheet would be. Distinct from FLOATING_TEACHER_CARD, which is for a
 * default teacher whose School Head has not assigned a section yet: this one
 * was a choice, so "ask for a section" would be the wrong advice.
 */
export const DECLARED_FLOATING_CARD = {
  icon: Sparkles,
  title: "You're a floating teacher",
  description:
    "Floating teachers don't advise a section, so there is no class roster or end-of-term sheet here. Your School Head can change this. Learners you tutor for ARAL are in the ARAL Program.",
  actionHref: "/teacher/aral",
  actionLabel: "Go to ARAL Program",
} as const;

/** The chip for a teacher holding no section who has NOT been set to Floating. */
export const UNASSIGNED_CHIP_LABEL = "Unassigned";
