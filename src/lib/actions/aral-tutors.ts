"use server";

import { requireSchoolUser } from "@/lib/auth/session";
import {
  listAralTutors,
  type AralTutorOption,
} from "@/lib/teachers/aral-tutor";
import { action } from "@/lib/errors/action";

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
 * Authorization: `requireSchoolUser(["TEACHER","SCHOOL_HEAD"])`. Tenancy: the
 * caller takes no id at all — the school comes from the session
 * (`user.schoolId`), so there is nothing for a caller to craft to reach
 * another tenant's teacher list.
 */
export const listAralTutorOptions = action(
  "listAralTutorOptions",
  async (): Promise<{ ok: true; data: AralTutorPickerData }> => {
    const user = await requireSchoolUser(["TEACHER", "SCHOOL_HEAD"]);

    const tutors = await listAralTutors(user.schoolId);
    return { ok: true, data: { tutors, selfId: user.id } };
  },
  { verb: "load the teacher list" }
);
