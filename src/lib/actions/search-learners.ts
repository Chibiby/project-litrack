"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth/session";
import { requireAdminScope, loadSchoolInScope } from "@/lib/auth/district-scope";
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
 * their own school; Super Admin may search any school; a district admin may
 * search a school only inside their assigned districts (used by
 * `/district/transfers`).
 */
export async function searchActiveLearners(input: {
  schoolId: string;
  q: string;
  take?: number;
}): Promise<SearchResult> {
  const user = await requireUser(["SCHOOL_HEAD", "SUPER_ADMIN", "DISTRICT_ADMIN"]);
  const schoolId = input.schoolId?.trim() ?? "";
  if (!schoolId) return { ok: false, error: "School is required" };

  if (user.role === "SCHOOL_HEAD") {
    if (!user.schoolId || user.schoolId !== schoolId) {
      return { ok: false, error: "Not found" };
    }
  }

  if (user.role === "DISTRICT_ADMIN") {
    // `requireAdminScope()` is memoized per request (React `cache()`), so this
    // does not repeat the assignment lookup `requireUser` above already paid
    // for. The scope check happens before any learner is read, exactly like
    // every other district-scoped read — an out-of-scope school reports the
    // same generic NOT_FOUND a missing row gets.
    const { scope } = await requireAdminScope();
    try {
      await loadSchoolInScope(scope, schoolId, { id: true });
    } catch {
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
