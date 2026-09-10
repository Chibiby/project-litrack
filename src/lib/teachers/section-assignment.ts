import type { Prisma } from "@prisma/client";
import { MAX_ADVISORY_SECTIONS } from "@/lib/teachers/advisory-limits";

type Tx = Prisma.TransactionClient;

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Load non-deleted sections that belong to `schoolId`.
 * Throws if any requested id is missing / wrong school / soft-deleted.
 */
async function loadValidSections(
  tx: Tx,
  sectionIds: string[],
  schoolId: string
): Promise<{ id: string; gradeLevelId: string }[]> {
  const ids = uniqueIds(sectionIds);
  if (ids.length === 0) return [];

  const sections = await tx.section.findMany({
    where: {
      id: { in: ids },
      schoolId,
      deletedAt: null,
    },
    select: { id: true, gradeLevelId: true },
  });

  if (sections.length !== ids.length) {
    throw new Error("One or more sections are invalid or do not belong to this school");
  }

  return sections;
}

/** Prisma unique-constraint violation (here: two advisers for one section). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "P2002"
  );
}

/**
 * Narrower than {@link isUniqueViolation}: true only when the P2002 came from
 * the `User.advisorySectionId` unique index (i.e. another teacher already
 * advises the section), so an unrelated unique violation inside the same
 * transaction is not mislabelled as "section taken".
 *
 * Prisma reports `meta.target` as a string[] on Postgres, but older/other
 * shapes (string, or the raw index name) are tolerated here.
 */
export function isAdvisorySectionConflict(err: unknown): boolean {
  if (!isUniqueViolation(err)) return false;
  const target = (err as { meta?: { target?: unknown } }).meta?.target;
  const parts = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : [];
  // Unknown target → fall back to the broad message rather than leaking raw error text.
  if (parts.length === 0) return true;
  return parts.some((p) => p.toLowerCase().includes("advisorysection"));
}

/**
 * Shared user-facing message for {@link isUniqueViolation} on
 * `User.advisorySectionId` — every caller of {@link setTeacherAdvisory} maps
 * P2002 to this exact text so it never drifts between call sites.
 */
export const SECTION_TAKEN_ERROR = "That section already has an adviser.";


/**
 * The cap, and the message when a teacher is already at it.
 *
 * In the action layer rather than in SQL, deliberately: three is a programme
 * decision, not a data-integrity one, and moving it must not need a migration.
 * SQL still guarantees the half that IS integrity — a section has one adviser,
 * because `Section.adviserId` is one column on one row.
 */
export { MAX_ADVISORY_SECTIONS } from "@/lib/teachers/advisory-limits";

export function advisoryCapError(held: string[]): string {
  return `A teacher may advise at most ${MAX_ADVISORY_SECTIONS} sections. This one already advises ${held.join(
    ", "
  )}. Remove one before adding another.`;
}

/**
 * Add one section to a teacher's advisories, or remove one.
 *
 * Wave A of multi-advisory turned this from "set the one" into "change the set",
 * which is why it takes an operation rather than a nullable section id. The old
 * signature could not express "add a second" — passing a section replaced
 * whatever was there, silently, and that is the behaviour being removed.
 *
 * `Section.adviserId` is authoritative. `User.advisorySectionId` is DUAL-WRITTEN
 * to hold the teacher's first remaining advisory (or null), so the dying mirror
 * stays a truthful subset until Wave B drops it. Nothing reads it for access.
 *
 * Throws `AdvisoryCapError` when a fourth is requested, and Prisma P2002 when
 * another teacher already advises the section — the calling action maps both to
 * user-facing text rather than swallowing them, so an adviser is never silently
 * displaced and a cap is never silently exceeded.
 */
export class AdvisoryCapError extends Error {
  constructor(public readonly held: string[]) {
    super(advisoryCapError(held));
    this.name = "AdvisoryCapError";
  }
}

export type AdvisoryChange =
  | { op: "add"; sectionId: string }
  | { op: "remove"; sectionId: string }
  | { op: "clear" };

export async function setTeacherAdvisory(
  tx: Tx,
  params: { teacherId: string; schoolId: string; change: AdvisoryChange }
): Promise<{ sectionIds: string[]; gradeLevelIds: string[] }> {
  const { teacherId, schoolId, change } = params;

  // Live advisories, before the change. Archived sections are excluded on
  // purpose: they are not live assignments, so they do not count against the
  // cap and they are not "held" for the message either.
  const current = await tx.section.findMany({
    where: { adviserId: teacherId, schoolId, deletedAt: null },
    select: { id: true, name: true, gradeLevelId: true },
    orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }],
  });

  if (change.op === "add") {
    if (!current.some((s) => s.id === change.sectionId)) {
      if (current.length >= MAX_ADVISORY_SECTIONS) {
        throw new AdvisoryCapError(current.map((s) => s.name));
      }
      const [section] = await loadValidSections(tx, [change.sectionId], schoolId);
      // `updateMany` with an `adviserId IS NULL` guard rather than `update`: two
      // School Heads assigning the same section at once must not both succeed,
      // and the count tells us which one lost without reading the row again.
      const { count } = await tx.section.updateMany({
        where: { id: section.id, schoolId, deletedAt: null, adviserId: null },
        data: { adviserId: teacherId },
      });
      if (count === 0) {
        throw new SectionTakenError();
      }
    }
  } else if (change.op === "remove") {
    await tx.section.updateMany({
      // Scoped to this teacher, so a stale form cannot free somebody else's
      // section by naming it.
      where: { id: change.sectionId, schoolId, adviserId: teacherId },
      data: { adviserId: null },
    });
  } else {
    await tx.section.updateMany({
      where: { adviserId: teacherId, schoolId },
      data: { adviserId: null },
    });
  }

  const remaining = await tx.section.findMany({
    where: { adviserId: teacherId, schoolId, deletedAt: null },
    select: { id: true, gradeLevelId: true },
    orderBy: [{ gradeLevel: { type: "asc" } }, { name: "asc" }],
  });
  const sectionIds = remaining.map((s) => s.id);
  const gradeLevelIds = uniqueIds(remaining.map((s) => s.gradeLevelId));

  // Legacy `TeacherSection` mirror: the set of live advisories, no more.
  await tx.teacherSection.deleteMany({
    where: { teacherId, ...(sectionIds.length ? { sectionId: { notIn: sectionIds } } : {}) },
  });
  if (sectionIds.length > 0) {
    await tx.teacherSection.createMany({
      data: sectionIds.map((sectionId) => ({ teacherId, sectionId })),
      skipDuplicates: true,
    });
  }

  const teacher = await tx.user.findUniqueOrThrow({
    where: { id: teacherId },
    select: { advisorySectionId: true, taughtGrades: { select: { id: true } } },
  });
  const currentGradeIds = teacher.taughtGrades.map((g) => g.id);
  const toConnect = gradeLevelIds.filter((id) => !currentGradeIds.includes(id));
  const toDisconnect = currentGradeIds.filter((id) => !gradeLevelIds.includes(id));

  // The dying pointer holds the FIRST remaining advisory. It is `@unique`, so it
  // can only ever hold one of the three — which is exactly why nothing may read
  // it for access any more. See `Section.adviserId` for the authoritative set.
  const nextLegacyId = sectionIds[0] ?? null;
  const legacyChanged = teacher.advisorySectionId !== nextLegacyId;

  if (legacyChanged || toConnect.length > 0 || toDisconnect.length > 0) {
    await tx.user.update({
      where: { id: teacherId },
      data: {
        ...(legacyChanged ? { advisorySectionId: nextLegacyId } : {}),
        taughtGrades: {
          ...(toConnect.length > 0 ? { connect: toConnect.map((id) => ({ id })) } : {}),
          ...(toDisconnect.length > 0
            ? { disconnect: toDisconnect.map((id) => ({ id })) }
            : {}),
        },
      },
    });
  }

  return { sectionIds, gradeLevelIds };
}

/** Raised when the section was claimed between the check and the write. */
export class SectionTakenError extends Error {
  constructor() {
    super(SECTION_TAKEN_ERROR);
    this.name = "SectionTakenError";
  }
}
