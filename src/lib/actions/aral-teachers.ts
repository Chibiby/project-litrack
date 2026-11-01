"use server";

import { requireSchoolUser } from "@/lib/auth/session";
import {
  listAralTeachers,
  type AralTeacherPickOption,
} from "@/lib/teachers/aral-teacher";
import { action } from "@/lib/errors/action";

export type AralTeacherPickerData = {
  teachers: AralTeacherPickOption[];
  /** The caller's own id, so the picker can offer them as "Myself". */
  selfId: string;
};

/**
 * The ARAL teacher list for a picker that opens on demand.
 *
 * The roster renders one dialog for the whole page and most visits never open it,
 * so the list is fetched when the dialog opens rather than shipped with every
 * page of learners. Pages that always show a picker (the ARAL grade page, the
 * School Head ARAL tab) still read `listAralTeachers` directly in their server
 * component — same rule, same order, no waterfall where none is needed.
 *
 * Authorization: `requireSchoolUser(["TEACHER","SCHOOL_HEAD"])`. Tenancy: the
 * caller takes no id at all — the school comes from the session
 * (`user.schoolId`), so there is nothing for a caller to craft to reach
 * another tenant's teacher list.
 */
export const listAralTeacherOptions = action(
  "listAralTeacherOptions",
  async (): Promise<{ ok: true; data: AralTeacherPickerData }> => {
    const user = await requireSchoolUser(["TEACHER", "SCHOOL_HEAD"]);

    const teachers = await listAralTeachers(user.schoolId);
    return { ok: true, data: { teachers, selfId: user.id } };
  },
  { verb: "load the teacher list" }
);
