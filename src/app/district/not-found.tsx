import { notFoundLinksFor } from "@/lib/nav/not-found-links";
import { NotFoundContent } from "@/components/errors/not-found-content";

export default function DistrictNotFound() {
  return <NotFoundContent links={notFoundLinksFor("DISTRICT_ADMIN")} />;
}
