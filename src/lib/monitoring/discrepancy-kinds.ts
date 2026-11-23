/**
 * School Head Monitoring > Discrepancies — the contract.
 *
 * Plain types and constants only (no Prisma, no `server-only`), so the page,
 * the client list and the unit tests can all import it.
 */

export const DISCREPANCY_KINDS = [
  "NO_ADVISER",
  "NO_SECTION",
  "INACTIVE_ADVISER",
  "ADVISER_MISMATCH",
  "SECTION_GRADE_MISMATCH",
  "ARAL_NO_TUTOR",
  "NO_ENROLLMENT",
  "ENROLLMENT_MISMATCH",
  "SECTION_NO_ADVISER",
  "ARAL_WEEK_ONE_DAY",
] as const;

export type DiscrepancyKind = (typeof DISCREPANCY_KINDS)[number];

export type DiscrepancyMeta = {
  title: string;
  /** What is wrong, in one sentence. */
  description: string;
  /** What the School Head does about it. */
  fix: string;
  /**
   * Learner rows, section rows for `SECTION_NO_ADVISER`, or one row per tutor,
   * grade and week for `ARAL_WEEK_ONE_DAY`.
   */
  subject: "learner" | "section" | "tutor-week";
};

export const DISCREPANCY_META: Record<DiscrepancyKind, DiscrepancyMeta> = {
  NO_ADVISER: {
    title: "Learners with no adviser",
    description: "These learners are not on any teacher's advisory class.",
    fix: "Open the learner on the Learners page and choose an adviser, or place the learner in a section that has one.",
    subject: "learner",
  },
  NO_SECTION: {
    title: "Learners with no section",
    description: "These learners have a grade but no section.",
    fix: "Place each learner in a section of their grade.",
    subject: "learner",
  },
  INACTIVE_ADVISER: {
    title: "Adviser is inactive or removed",
    description: "The learner's adviser can no longer sign in, so nobody is keeping this learner's records.",
    fix: "Move the learner to an active adviser, or reactivate the teacher.",
    subject: "learner",
  },
  ADVISER_MISMATCH: {
    title: "Adviser differs from the section's adviser",
    description: "The learner's adviser is not the teacher who advises the learner's section.",
    fix: "Check which teacher should advise the learner and correct the section or adviser.",
    subject: "learner",
  },
  SECTION_GRADE_MISMATCH: {
    title: "Section is in a different grade",
    description: "The learner's section belongs to another grade level than the learner.",
    fix: "Correct the learner's grade or move the learner to a section of their grade.",
    subject: "learner",
  },
  ARAL_NO_TUTOR: {
    title: "ARAL learners with no active ARAL tutor",
    description: "These ARAL learners have no ARAL tutor, or their ARAL tutor is inactive or removed.",
    fix: "Assign an ARAL tutor on the Learners page.",
    subject: "learner",
  },
  NO_ENROLLMENT: {
    title: "Not enrolled in the active school year",
    description: "These learners have no active enrollment for the current school year.",
    fix: "Enroll the learner in the active school year, or remove the learner if they have left.",
    subject: "learner",
  },
  ENROLLMENT_MISMATCH: {
    title: "Enrollment does not match the learner",
    description: "The learner's grade or section differs from their active enrollment record.",
    fix: "Re-save the learner's grade and section so the enrollment record is updated.",
    subject: "learner",
  },
  SECTION_NO_ADVISER: {
    title: "Sections with no active adviser",
    description: "These sections have no adviser, or their adviser is inactive or removed.",
    fix: "Assign an adviser to the section in Grade and Section.",
    subject: "section",
  },
  ARAL_WEEK_ONE_DAY: {
    title: "ARAL weeks with only 1 attendance day",
    description:
      "In these finished weeks the ARAL tutor recorded Weekly Attendance on only one day for the grade. Each week needs at least 2 days.",
    fix: "Ask the tutor to fill in the missing days of that week in Weekly Attendance.",
    subject: "tutor-week",
  },
};

export type DiscrepancyItem = {
  id: string;
  /** Learner name (surname first) or section name. */
  name: string;
  /** "Grade 4 · Sampaguita", or the grade alone. */
  placement: string;
  /** The teacher the row points at, when there is one ("Cruz, Ana"). */
  teacher: string | null;
};

export type DiscrepancyGroup = {
  kind: DiscrepancyKind;
  count: number;
  /** At most `DISCREPANCY_LIST_LIMIT` rows, name order. */
  items: DiscrepancyItem[];
};

export type DiscrepancySummary = {
  groups: DiscrepancyGroup[];
  /** Sum of every group's count. One learner can appear in more than one group. */
  total: number;
  hasActiveYear: boolean;
};

export const DISCREPANCY_LIST_LIMIT = 200;
