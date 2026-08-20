"use server";

import { requireSchoolUser } from "@/lib/auth/session";
import {
  listAralTutors,
  type AralTutorOption,
} from "@/lib/teachers/aral-tutor";

type ActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; error: string; data?: T };

export type AralTutorPickerData = {
  tutors: AralTutorOption[];
  /** The caller's own id, so the picker can offer them as "Myself". */
  selfId: string;
};

/**
 * The ARAL tutor list for a picker that opens on demand.
 *
 * The roster renders one dialog for the whole page and most visits never open it,
 * so the list is fetched when the dialog opens rather than shipped with every
 * page of learners. Pages that always show a picker (the ARAL grade page, the
 * School Head ARAL tab) still read `listAralTutors` directly in their server
 * component — same rule, same order, no waterfall where none is needed.
 *
 * Reads nothing from the client: the school comes from the session, so a caller
 * cannot ask for another tenant's teachers.
 */
export async function listAralTutorOptions(): Promise<
  ActionResult<AralTutorPickerData>
> {
  const user = await requireSchoolUser(["TEACHER", "SCHOOL_HEAD"]);

  try {
    const tutors = await listAralTutors(user.schoolId);
    return { ok: true, data: { tutors, selfId: user.id } };
  } catch (err) {
    console.error("[aral-tutors] list failed:", err);
    return { ok: false, error: "Could not load teachers. Please try again." };
  }
}
