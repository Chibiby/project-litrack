/** Max hits returned by transfer learner typeahead / search actions. */
export const LEARNER_SEARCH_TAKE = 20;

/** Minimum characters before querying (avoids unbounded prefix dumps). */
export const LEARNER_SEARCH_MIN_CHARS = 1;

export type LearnerSearchHit = {
  id: string;
  fullName: string;
  gradeLevelId: string;
  gradeLabel: string;
};
