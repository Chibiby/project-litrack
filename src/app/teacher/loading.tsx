import { ContentRouteLoading } from "@/components/loading/content-route-loading";

/**
 * Content-only route fallback. Sidebar + breadcrumbs stay mounted in
 * `teacher/layout.tsx` → RoleShell. Do not remount full dashboard skeletons
 * on every navigation — nav routes are background-prefetched once per shell.
 */
export default function TeacherLoading() {
  return <ContentRouteLoading />;
}
