"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";
import {
  LEARNER_SEARCH_MIN_CHARS,
  LEARNER_SEARCH_TAKE,
  type LearnerSearchHit,
} from "@/lib/learners/search";

type SearchResult =
  | { ok: true; data: LearnerSearchHit[] }
  | { ok: false; error: string };

/**
 * Typeahead for transfer UIs: active (non-archived) learners in a school,
 * filtered by name with a hard `take` cap. School Heads may only search
 * their own school; Super Admin may search any school.
 */
export async function searchActiveLearners(input: {
  schoolId: string;
  q: string;
  take?: number;
}): Promise<SearchResult> {
  const user = await requireUser(["SCHOOL_HEAD", "SUPER_ADMIN"]);
  const schoolId = input.schoolId?.trim() ?? "";
  if (!schoolId) return { ok: false, error: "School is required" };

  if (user.role === "SCHOOL_HEAD") {
    if (!user.schoolId || user.schoolId !== schoolId) {
      return { ok: false, error: "Not found" };
    }
  }

  const q = (input.q ?? "").trim();
  if (q.length < LEARNER_SEARCH_MIN_CHARS) {
    return { ok: true, data: [] };
  }

  const takeRaw = input.take ?? LEARNER_SEARCH_TAKE;
  const take = Math.min(Math.max(1, takeRaw), LEARNER_SEARCH_TAKE);

  const rows = await prisma.learner.findMany({
    where: {
      schoolId,
      deletedAt: null,
      archivedAt: null,
      fullName: { contains: q, mode: "insensitive" },
    },
    select: {
      id: true,
      fullName: true,
      gradeLevelId: true,
      gradeLevel: { select: { type: true } },
    },
    orderBy: { fullName: "asc" },
    take,
  });

  return {
    ok: true,
    data: rows.map((l) => ({
      id: l.id,
      fullName: l.fullName,
      gradeLevelId: l.gradeLevelId,
      gradeLabel: GRADE_LEVEL_LABELS[l.gradeLevel.type] ?? l.gradeLevel.type,
    })),
  };
}
