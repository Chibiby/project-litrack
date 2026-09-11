import { notFound } from "next/navigation";

/**
 * Unknown URLs under /teacher render the in-shell 404 instead of the bare root
 * one, so the sidebar stays put and the person is still oriented.
 *
 * A catch-all has the lowest routing priority in Next, so no real route is
 * shadowed by it. Signed-out visitors never reach here: the layout authenticates
 * before this renders, and sends them to sign in.
 */
export default function MissingTeacherRoute() {
  notFound();
}
