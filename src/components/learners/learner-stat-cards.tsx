import type { Prisma } from "@prisma/client";
import { Sparkles, User, UserRound, Users } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { StatCard, StatCardRow } from "@/components/dashboard/teacher/stat-cards";
import { teacherLearnerScope } from "@/lib/teachers/scope";

/**
 * The roster's four figures, to the comp.
 *
 * Deliberately counted over the teacher's whole active roster rather than the
 * current toolbar facets: these cards frame the list ("of my 16 learners, 8 are
 * boys"), while the footer's "Showing 1 to 10 of 16" is what reports the
 * filtered view. Re-counting them per filter would make the two lines say the
 * same thing twice and leave the teacher without a denominator.
 *
 * Read-only by direction — a "view all learners" link would point at the page
 * the reader is already on.
 */
export async function LearnerStatCards({
  assignedGradeIds,
  teacherId,
  isSuperAdmin,
}: {
  assignedGradeIds: string[];
  teacherId: string;
  isSuperAdmin: boolean;
}) {
  const base: Prisma.LearnerWhereInput = {
    gradeLevelId: { in: assignedGradeIds },
    deletedAt: null,
    archivedAt: null,
    ...(isSuperAdmin ? {} : teacherLearnerScope(teacherId)),
  };

  const [total, aral, male, female] = await Promise.all([
    prisma.learner.count({ where: base }),
    prisma.learner.count({ where: { ...base, isAralLearner: true } }),
    prisma.learner.count({ where: { ...base, gender: "MALE" } }),
    prisma.learner.count({ where: { ...base, gender: "FEMALE" } }),
  ]);

  /** Share of the roster, blank when there is no roster to take a share of. */
  const share = (n: number) =>
    total === 0 ? "No learners yet" : `${Math.round((n / total) * 100)}% of total`;

  return (
    <StatCardRow>
      <StatCard
        title="Total Learners"
        value={total}
        hint="All enrolled learners"
        icon={Users}
        tone="amber"
      />
      <StatCard
        title="ARAL Learners"
        value={aral}
        hint="In the ARAL program"
        icon={Sparkles}
        tone="emerald"
      />
      <StatCard
        title="Male Learners"
        value={male}
        hint={share(male)}
        icon={User}
        tone="primary"
      />
      <StatCard
        title="Female Learners"
        value={female}
        hint={share(female)}
        icon={UserRound}
        tone="violet"
      />
    </StatCardRow>
  );
}
