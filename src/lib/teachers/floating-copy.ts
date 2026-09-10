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
