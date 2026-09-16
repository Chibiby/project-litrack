import "server-only";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { AdvisoryPlacement } from "@/lib/teachers/advisory";
import type { KinderCompetencyKey, KinderCompetencyRatingCode } from "@/lib/terms/kinder-competencies";

/**
 * Read side of the Kindergarten End-of-Term competency checklist — see
 * docs/superpowers/specs/2026-09-16-kinder-end-of-term-checklist.md section 5.
 * Mirrors `sheet-data.ts`'s shape and doc-comment style.
 *
 * DEVIATION FROM THE SPEC'S LITERAL SIGNATURE: section 5's code block takes
 * `advisory: AdvisoryPlacement` directly. The owner decisions that override
 * section 4 (see the task brief) call for a School Head read-only view of
 * this same checklist, and a School Head is not an adviser — there is no
 * `AdvisoryPlacement` to hand it. So this loader takes a caller-supplied
 * `learnerWhere` (the same `Prisma.LearnerWhereInput` convention
 * `SheetScope.rosterWhere` already uses in `sheet-data.ts`) instead of baking
 * the teacher's advisory into the query shape. `kinderAdvisoryLearnerWhere`
 * below builds that filter for the teacher case; a School Head caller builds
 * its own school-scoped filter instead.
 *
 * Tenancy + advisory scoping happens in the one `learner.findFirst` below,
 * following the exact pattern `ReadingLevelPage` already uses for a nested
 * per-learner page: the caller's `learnerWhere` MUST already carry `schoolId`,
 * `deletedAt: null` and `archivedAt: null` (and `sectionId` for a teacher
 * caller — not `gradeLevelId`, a denormalized pointer that can drift from the
 * section's own grade). A miss is `notFound()` — this is the tenancy/advisory
 * boundary, not a second check bolted on after. `KinderCompetencyRecord`
 * carries no `schoolId` of its own (see the model's own doc comment, matching
 * `TermGrade`), so this learner-first load is the only place tenancy is
 * enforced for the read.
 *
 * Caching: none, deliberately, matching `loadTermSheet` — every role page
 * here is `force-dynamic`, and this read is one learner's <=62 rows.
 */

export type KinderChecklistRecord = {
  t1Rating: KinderCompetencyRatingCode | null;
  t2Rating: KinderCompetencyRatingCode | null;
  t3Rating: KinderCompetencyRatingCode | null;
  remark: string | null;
};

export type LoadedKinderChecklist = {
  learner: { id: string; fullName: string };
  records: Map<KinderCompetencyKey, KinderChecklistRecord>;
};

export async function loadKinderChecklist(args: {
  schoolYearId: string;
  learnerId: string;
  /**
   * The caller's tenancy/advisory scope. Must already carry `schoolId`,
   * `deletedAt: null` and `archivedAt: null` — the loader only ever ANDs the
   * `id` filter onto it, so it can never widen a scope the caller did not
   * already grant.
   */
  learnerWhere: Prisma.LearnerWhereInput;
}): Promise<LoadedKinderChecklist> {
  const { schoolYearId, learnerId, learnerWhere } = args;

  const learner = await prisma.learner.findFirst({
    where: { id: learnerId, ...learnerWhere },
    select: { id: true, fullName: true },
  });
  if (!learner) notFound();

  const rows = await prisma.kinderCompetencyRecord.findMany({
    where: { learnerId: learner.id, schoolYearId },
    select: {
      competencyKey: true,
      t1Rating: true,
      t2Rating: true,
      t3Rating: true,
      remark: true,
    },
  });

  const records = new Map<KinderCompetencyKey, KinderChecklistRecord>();
  for (const row of rows) {
    records.set(row.competencyKey as KinderCompetencyKey, {
      t1Rating: row.t1Rating,
      t2Rating: row.t2Rating,
      t3Rating: row.t3Rating,
      remark: row.remark,
    });
  }

  return { learner, records };
}

/**
 * The teacher-side `learnerWhere`: this advisory's roster, live and
 * un-deleted. A School Head caller (section 10, not built here) supplies its
 * own school-scoped filter instead of this helper.
 */
export function kinderAdvisoryLearnerWhere(
  schoolId: string,
  advisory: Pick<AdvisoryPlacement, "sectionId">
): Prisma.LearnerWhereInput {
  // Deliberately NOT gated on `gradeLevelId`: it is a denormalized pointer on
  // `Learner` that can drift from the section's own grade (see CLAUDE.md).
  // A section belongs to exactly one school (`Section.schoolId`), so
  // `schoolId` + `sectionId` is already a complete tenancy boundary without
  // it — requiring the pointer too just hides a learner whose pointer has
  // drifted, which is the bug this filter existed to avoid.
  return {
    schoolId,
    sectionId: advisory.sectionId,
    deletedAt: null,
    archivedAt: null,
  };
}
