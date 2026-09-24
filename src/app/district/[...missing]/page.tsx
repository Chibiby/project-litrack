import { notFound } from "next/navigation";

/** Keeps the district shell mounted on an unknown URL, like the other role areas. */
export default function MissingDistrictRoute() {
  notFound();
}
