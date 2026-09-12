import { notFoundLinksFor } from "@/lib/nav/not-found-links";
import { NotFoundContent } from "@/components/errors/not-found-content";

export default function SchoolHeadNotFound() {
  return <NotFoundContent links={notFoundLinksFor("SCHOOL_HEAD")} />;
}
