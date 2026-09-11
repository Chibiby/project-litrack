import { notFound } from "next/navigation";

/** See the teacher counterpart: keeps the shell mounted on an unknown URL. */
export default function MissingAdminRoute() {
  notFound();
}
