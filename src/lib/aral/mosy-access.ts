import "server-only";
import { prisma } from "@/lib/prisma";
import { getAdvisoryPlacements } from "@/lib/teachers/advisory";
import { advisoryRosterDenial } from "@/lib/teachers/scope";

export type MosyAccess =
  | { ok: true; sectionIds: string[] | null }
  | { ok: false; reason: "volunteer" | "floating" | "no_advisory"; message: string };

const VOLUNTEER_MESSAGE = "MOSY Report is for DepEd teachers who advise a section.";
// A floating teacher IS a DepEd teacher, so the message above would be wrong
// about them and would send them to the wrong person to fix it.
const FLOATING_MESSAGE =
  "Floating teachers do not advise a section, so there is no MOSY Report. Your School Head can change this.";
const NO_ADVISORY_MESSAGE =
  "You have no advisory section yet. Ask your School Head to assign you one to use the MOSY Report.";

/**
 * Who may open or save the MOSY Report, and over which sections.
 *
 * The report is the DepEd adviser's, not the ARAL tutor's. Same gate as the End
 * of Terms sheet (`requireAdvisoryForTermSheet`): `advisoryRosterDenial` decides
 * Non-DepEd ARAL Volunteer and Floating; a DepEd teacher with no live advisory
 * section is refused as `no_advisory`.
 *
 * `sectionIds` is the scope every MOSY query and save takes: the teacher's live
 * advisory sections (`getAdvisoryPlacements`, which pins `schoolId` and
 * `deletedAt: null`), or `null` for a Super Admin, who sees the whole school
 * read-only. The Super Admin's school is the session's `schoolId`, and every MOSY
 * query pins it. The profile read keeps the tenant in its `where`.
 */
export async function resolveMosyAccess(user: {
  id: string;
  role: string;
  schoolId: string;
}): Promise<MosyAccess> {
  if (user.role === "SUPER_ADMIN") return { ok: true, sectionIds: null };

  // `findFirst` over `findUnique` so the tenant stays in the where clause.
  const profile = await prisma.teacherProfile.findFirst({
    where: { userId: user.id, user: { schoolId: user.schoolId } },
    select: { designation: true, advisoryMode: true },
  });
  const denial = advisoryRosterDenial({
    isSuperAdmin: false,
    designation: profile?.designation,
    advisoryMode: profile?.advisoryMode,
  });
  if (denial === "volunteer") {
    return { ok: false, reason: "volunteer", message: VOLUNTEER_MESSAGE };
  }
  if (denial === "floating") {
    return { ok: false, reason: "floating", message: FLOATING_MESSAGE };
  }

  const placements = await getAdvisoryPlacements({ id: user.id, schoolId: user.schoolId });
  if (placements.length === 0) {
    return { ok: false, reason: "no_advisory", message: NO_ADVISORY_MESSAGE };
  }
  return { ok: true, sectionIds: placements.map((p) => p.sectionId) };
}
