import "server-only";
import { prisma } from "@/lib/prisma";
import { GRADE_LEVEL_LABELS } from "@/lib/constants/enum-labels";

/**
 * Where a teacher's new learners go: a section they advise, plus the grade that
 * section sits in.
 *
 * `gradeLevelId` is DERIVED from the section and never stored on the teacher.
 */
export type AdvisoryPlacement = {
  sectionId: string;
  sectionName: string;
  gradeLevelId: string;
  /** Raw `GradeLevelType`, for anything that branches on the early grades. */
  gradeType: string;
  gradeLabel: string;
  /** "Grade 4 · Sampaguita" — the one spelling every surface should use. */
  label: string;
};

/**
 * What a grade-scoped advisory page should do with the URL it was given.
 *
 * Multi-advisory means a teacher can hold sections in several grades AND
 * several sections inside one grade, so a grade id alone is not always enough
 * to name one section. Falling back to "the first placement" — which is what
 * this used to do — silently opened someone else's class: the teacher saw a
 * roster, believed it was the one they asked for, and encoded into it.
 *
 * Four answers, because the four situations want four different pages:
 *
 * - **none** — the teacher advises nothing anywhere.
 * - **elsewhere** — they advise, but not in this grade. Send them to the
 *   chooser rather than to a sheet they did not ask for.
 * - **choose** — this grade holds several of their sections and the URL named
 *   none of them (or named one they do not hold). Ask; never guess.
 * - **placement** — exactly one section is in scope, so the page can render.
 */
export type AdvisoryGradeScope =
  | { kind: "placement"; placement: AdvisoryPlacement }
  | { kind: "choose"; options: AdvisoryPlacement[] }
  | { kind: "elsewhere"; options: AdvisoryPlacement[] }
  | { kind: "none" };

export function resolveAdvisoryGradeScope(
  placements: AdvisoryPlacement[],
  gradeLevelId: string,
  requestedSectionId?: string | null
): AdvisoryGradeScope {
  if (placements.length === 0) return { kind: "none" };

  const inGrade = placements.filter((p) => p.gradeLevelId === gradeLevelId);
  if (inGrade.length === 0) return { kind: "elsewhere", options: placements };

  if (requestedSectionId) {
    const match = inGrade.find((p) => p.sectionId === requestedSectionId);
    // A section id that is not one of theirs *in this grade* reads the same as
    // one that does not exist: ask again rather than confirm or deny it.
    if (match) return { kind: "placement", placement: match };
    return inGrade.length === 1
      ? { kind: "placement", placement: inGrade[0] }
      : { kind: "choose", options: inGrade };
  }

  if (inGrade.length === 1) return { kind: "placement", placement: inGrade[0] };
  return { kind: "choose", options: inGrade };
}

/**
 * The distinct grades a teacher advises in, in placement order.
 *
 * The sidebar and the dashboard both deep-link into a grade-scoped sheet, and
 * both may only do so when the destination is unambiguous. Keeping the rule
 * here means they cannot come to disagree about what "unambiguous" means.
 */
export function advisoryGradeLevelIds(
  placements: { gradeLevelId: string }[]
): string[] {
  return [...new Set(placements.map((p) => p.gradeLevelId))];
}

export { MAX_ADVISORY_SECTIONS } from "@/lib/teachers/advisory-limits";

/**
 * Every section this teacher advises, ordered as a person would list them.
 *
 * Reads `Section.adviserId`, the authoritative pointer since Wave A of the
 * multi-advisory change. The legacy `User.advisorySectionId` is still written
 * but is not consulted here or anywhere else that decides access.
 *
 * Soft-deleted sections are excluded, and that filter is load-bearing: a School
 * Head can archive a section after it was assigned, and rostering into an
 * archived section would put the learner somewhere no roster page lists. An
 * archived section reads the same as no assignment — which is what the teacher
 * effectively has.
 *
 * One source of truth for both halves of the feature: the roster page renders
 * these and decides whether adding a learner is possible at all, and
 * `createLearner` derives the placement it writes from the same list. They
 * cannot disagree about which grades a teacher belongs to, which is exactly the
 * bug that made the old grade dropdown offer grades the action then refused.
 */
export async function getAdvisoryPlacements(user: {
  id: string;
  schoolId: string;
}): Promise<AdvisoryPlacement[]> {
  const sections = await prisma.section.findMany({
    relationLoadStrategy: "join",
    where: {
      adviserId: user.id,
      schoolId: user.schoolId,
      deletedAt: null,
    },
    select: {
      id: true,
      name: true,
      gradeLevelId: true,
      gradeLevel: { select: { type: true } },
    },
    orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }],
  });

  return sections.map((section) => {
    const gradeLabel =
      GRADE_LEVEL_LABELS[section.gradeLevel.type] ?? section.gradeLevel.type;
    return {
      sectionId: section.id,
      sectionName: section.name,
      gradeLevelId: section.gradeLevelId,
      gradeType: section.gradeLevel.type,
      gradeLabel,
      label: `${gradeLabel} · ${section.name}`,
    };
  });
}

/**
 * Which of a teacher's advisories a write belongs to.
 *
 * Pure, so it can be tested without a database and reused by every action that
 * has to land in exactly one section.
 *
 * The three cases are deliberately different answers rather than one nullable
 * placement:
 *
 * - **none** — the teacher advises nothing, and `NO_ADVISORY_MESSAGE` is right.
 * - **one** — the common case and the only one that existed before multi-advisory.
 *   No section has to be named, and nothing about the old behaviour changes.
 * - **many** — a section must be named. Silently picking the first would put a
 *   learner in a class the teacher did not choose, which is worse than asking:
 *   the mistake is invisible until someone notices a learner in the wrong room.
 */
export type AdvisoryTarget =
  | { ok: true; placement: AdvisoryPlacement }
  | { ok: false; reason: "none" | "unspecified" | "not-yours"; error: string };

export function resolveAdvisoryTarget(
  placements: AdvisoryPlacement[],
  requestedSectionId?: string | null
): AdvisoryTarget {
  if (placements.length === 0) {
    return { ok: false, reason: "none", error: NO_ADVISORY_MESSAGE };
  }

  if (requestedSectionId) {
    const match = placements.find((p) => p.sectionId === requestedSectionId);
    if (!match) {
      // Generic on purpose: a section in another school, or another teacher's,
      // must read the same as one that does not exist.
      return { ok: false, reason: "not-yours", error: NOT_YOUR_ADVISORY_MESSAGE };
    }
    return { ok: true, placement: match };
  }

  if (placements.length === 1) {
    return { ok: true, placement: placements[0] };
  }

  return {
    ok: false,
    reason: "unspecified",
    error: `You advise ${placements.length} sections (${placements
      .map((p) => p.label)
      .join(", ")}). Choose which one this belongs to.`,
  };
}

/**
 * The one sentence every surface uses when a teacher has no advisory section.
 *
 * Shared so the roster's disabled Add button and the action's rejection say the
 * same thing — a teacher who ignores the first and posts anyway should not get a
 * second, differently-worded explanation of the same situation.
 */
export const NO_ADVISORY_MESSAGE =
  "You have no advisory section yet. Ask your School Head to assign you one before adding learners.";

/** Named the same way, and equally placement-free: it must not confirm that the section exists. */
export const NOT_YOUR_ADVISORY_MESSAGE =
  "That section is not one of your advisory sections.";
