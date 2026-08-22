import { prisma } from "@/lib/prisma";
import { Skeleton } from "@/components/ui/skeleton";
import { EnrollToAralDialog } from "@/components/aral/enroll-to-aral-dialog";
import { listAralTutors } from "@/lib/teachers/aral-tutor";

/**
 * The "Enroll to ARAL" header control, with the two lists it needs.
 *
 * Shared by the weekly attendance and end-of-terms sheets, which offer the same
 * control and had grown two identical copies of this query pair with two
 * different explanations for it.
 *
 * Stream it behind its own `<Suspense>`, with `AralEnrollActionFallback` as the
 * fallback. Neither list feeds anything else on either page, and the control
 * opens a sheet the teacher has not asked for yet, so making first paint wait on
 * them buys nothing — on the terms sheet that wait was the slowest read on the
 * critical path. The fallback is the trigger's own footprint, so the real button
 * drops in without moving the header around it.
 *
 * Adviser-only by construction: the candidate roster is scoped to `teacherId`,
 * matching `enrollLearnersToAral`, which gates the roster write on the advisory
 * grade. A Super Admin advises nothing anywhere, so both call sites render this
 * only when `!isSuperAdmin` rather than passing a flag that would make every
 * branch in here unreachable.
 */
export async function AralEnrollAction({
  gradeId,
  schoolId,
  teacherId,
}: {
  gradeId: string;
  schoolId: string;
  teacherId: string;
}) {
  const [enrollCandidates, tutors] = await Promise.all([
    prisma.learner.findMany({
      where: {
        gradeLevelId: gradeId,
        teacherId,
        isAralLearner: false,
        deletedAt: null,
        archivedAt: null,
      },
      select: {
        id: true,
        fullName: true,
        section: { select: { name: true } },
      },
      orderBy: { fullName: "asc" },
    }),
    listAralTutors(schoolId),
  ]);

  const candidates = enrollCandidates.map((l) => ({
    id: l.id,
    fullName: l.fullName,
    sectionName: l.section?.name ?? null,
  }));

  return (
    <EnrollToAralDialog
      gradeId={gradeId}
      candidates={candidates}
      tutors={tutors}
      selfId={teacherId}
    />
  );
}

/**
 * The trigger's own footprint — a default-size button, not `size="sm"` — so the
 * streamed control lands in the space already held for it.
 */
export function AralEnrollActionFallback() {
  return <Skeleton className="h-10 w-[150px] rounded-lg" />;
}
