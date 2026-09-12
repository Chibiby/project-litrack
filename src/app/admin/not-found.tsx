import { notFoundLinksFor } from "@/lib/nav/not-found-links";
import { NotFoundContent } from "@/components/errors/not-found-content";

export default function AdminNotFound() {
  return <NotFoundContent links={notFoundLinksFor("SUPER_ADMIN")} />;
}
