import { notFoundLinksFor } from "@/lib/nav/not-found-links";
import { NotFoundContent } from "@/components/errors/not-found-content";

export default function TeacherNotFound() {
  return <NotFoundContent links={notFoundLinksFor("TEACHER")} />;
}
