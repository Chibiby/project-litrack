import { ContentRouteLoading } from "@/components/loading";

/** Minimal busy state — avoid flashing the teacher dashboard skeleton. */
export default function TeacherPasswordLoading() {
  return <ContentRouteLoading />;
}
