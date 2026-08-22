import { Sparkles } from "lucide-react";

/**
 * The two refusal cards the End of Terms sheet renders when the viewer is not a
 * DepEd adviser.
 *
 * Shared because there are two entry points — the resolver at
 * `/teacher/terms-reports` and the sheet itself at
 * `/teacher/aral/[gradeId]/terms-reports` — and a teacher who is turned away by
 * one and then types the other must not get a second, differently-worded
 * explanation of the same situation. Same reasoning as `NO_ADVISORY_MESSAGE` in
 * `src/lib/teachers/advisory.ts`.
 *
 * Both spell out the nav's own phrase, "for DepEd teachers who advise a section",
 * so the "DepEd only" pill and the page it guards say the same thing at the two
 * different lengths their surfaces allow. Shaped as `EmptyState` props so the
 * pages spread them and cannot re-title or re-icon one copy.
 */

/** A Non-DepEd ARAL Volunteer: no advisory section by definition. */
export const TERM_SHEET_VOLUNTEER_CARD = {
  icon: Sparkles,
  title: "Open to DepEd advisers only",
  description:
    "End of Terms Reports is for DepEd teachers who advise a section. As a Non-DepEd ARAL Volunteer you don't advise one, so there is no class grade sheet to encode here. Your ARAL learners are in the ARAL Program.",
  actionHref: "/teacher/aral",
  actionLabel: "Go to ARAL Program",
} as const;

/** A DepEd teacher whose School Head has not assigned them a section yet. */
export const TERM_SHEET_NO_ADVISORY_CARD = {
  icon: Sparkles,
  title: "No advisory section yet",
  description:
    "End of Terms Reports is for DepEd teachers who advise a section — the sheet covers a whole class. Ask your School Head to assign you an advisory section, and this page will open on it.",
  actionHref: "/teacher/aral",
  actionLabel: "Go to ARAL Program",
} as const;
