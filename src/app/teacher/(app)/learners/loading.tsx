import { LearnerRosterSkeleton } from "@/components/learners/learner-roster-skeleton";

/**
 * Content-slot only — RoleShell sidebar stays mounted during soft nav.
 *
 * Draws the same skeleton the page's own Suspense fallbacks draw, so the
 * handover from this boundary to the page is invisible instead of swapping one
 * skeleton for a differently-shaped second one.
 */
export default function TeacherLearnersLoading() {
  return <LearnerRosterSkeleton />;
}
