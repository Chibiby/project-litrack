import { peekCurrentUser } from "@/lib/auth/session";
import { notFoundLinksFor } from "@/lib/nav/not-found-links";
import { NotFoundContent } from "@/components/errors/not-found-content";

/**
 * `peekCurrentUser`, not `getCurrentUser`: the latter redirects pending and
 * declined teachers, which on a 404 would bounce someone away from the page
 * explaining where they are.
 */
export default async function NotFound() {
  const user = await peekCurrentUser();
  return <NotFoundContent links={notFoundLinksFor(user?.role ?? null)} />;
}
