import { redirect } from "next/navigation";

/*
 * The standalone edit page is gone.
 *
 * Editing a learner is a mode of the Student Profile dialog now — see
 * `LearnerEditButton` on the detail page and the Edit action in the roster's
 * dialog footer. Nothing in the app links here any more.
 *
 * What is left is a forward, not a page: a teacher with this URL in their
 * history lands on the learner they meant to edit, one press from the form,
 * instead of a 404. No auth guard and no read of its own — the detail page it
 * forwards to runs both.
 */

export const dynamic = "force-dynamic";

interface EditLearnerRedirectProps {
  params: Promise<{ id: string; learnerId: string }>;
}

export default async function EditLearnerRedirect({
  params,
}: EditLearnerRedirectProps) {
  const { id: gradeId, learnerId } = await params;
  redirect(`/teacher/grade/${gradeId}/learners/${learnerId}`);
}
