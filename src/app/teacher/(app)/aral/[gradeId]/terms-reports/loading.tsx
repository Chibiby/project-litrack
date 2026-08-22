import { AralTermGradesRouteSkeleton } from "@/components/loading";

/**
 * Busy state for the end of terms grade sheet.
 *
 * Content slot only: `RoleShell`'s sidebar and header stay mounted across a
 * soft nav, so this draws the gutter, the title block, and the sheet — the
 * same three things the page paints first — and nothing else.
 */
export default function TeacherAralTermsReportsLoading() {
  return <AralTermGradesRouteSkeleton />;
}
