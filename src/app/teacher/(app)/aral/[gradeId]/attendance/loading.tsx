import { AralAttendanceRouteSkeleton } from "@/components/loading";
import { RouteLoadingOverlay } from "@/components/loading/route-loading-overlay";

/**
 * Busy state for the weekly attendance sheet.
 *
 * Content slot only: `RoleShell`'s sidebar and header stay mounted across a
 * soft nav, so this draws the gutter, the title block, and the sheet — the
 * same three things the page paints first — and nothing else.
 */
export default function TeacherAralAttendanceLoading() {
  return (
    <RouteLoadingOverlay>
      <AralAttendanceRouteSkeleton />
    </RouteLoadingOverlay>
  );
}
