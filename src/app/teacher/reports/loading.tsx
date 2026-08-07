import { ContentRouteLoading } from "@/components/loading";

/** Avoid flashing the teacher dashboard skeleton on reports soft-nav. */
export default function TeacherReportsLoading() {
  return <ContentRouteLoading />;
}