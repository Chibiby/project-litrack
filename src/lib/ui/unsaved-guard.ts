/**
 * A page-wide registry for "this screen holds typed input that is not saved".
 *
 * The controls that would throw the input away (grade and section selects, the
 * advisory switcher, pager links, the week or month picker) live in different
 * components from the grid that holds it, and on the terms page in different
 * server-rendered branches of the tree, so a React context cannot reach all of
 * them. One screen has one grid, so a single active guard is enough.
 */
export type UnsavedGuard = {
  isDirty: () => boolean;
  /** Ask the teacher what to do; `proceed` runs only if they choose to continue. */
  request: (proceed: () => void) => void;
};

let active: UnsavedGuard | null = null;

export function registerUnsavedGuard(guard: UnsavedGuard): () => void {
  active = guard;
  return () => {
    if (active === guard) active = null;
  };
}

/** Runs `proceed` now when nothing is unsaved, otherwise after the teacher's answer. */
export function runGuarded(proceed: () => void): void {
  if (active?.isDirty()) active.request(proceed);
  else proceed();
}

type AnchorLike = Pick<HTMLAnchorElement, "href" | "target" | "hasAttribute">;
type ClickLike = Pick<
  MouseEvent,
  "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented"
>;
type LocationLike = Pick<Location, "origin" | "pathname" | "search">;

/**
 * Route handlers (exports, backups), framework assets and file links are
 * downloads or fetches, not pages: holding them and re-pushing them as a soft
 * navigation would break them, so the browser keeps them.
 */
function isPageRoute(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/_next/")) return false;
  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !/\.[A-Za-z0-9]{1,8}$/.test(lastSegment);
}

/**
 * The in-app destination of a plain left click on a link, or null when the
 * browser should be left to handle it: modified clicks (new tab), other targets,
 * downloads, other origins, and links to the page already open.
 */
export function internalNavigationHref(
  anchor: AnchorLike,
  event: ClickLike,
  location: LocationLike
): string | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;

  let url: URL;
  try {
    url = new URL(anchor.href, location.origin);
  } catch {
    return null;
  }
  if (url.origin !== location.origin) return null;
  if (url.pathname === location.pathname && url.search === location.search) return null;
  if (!isPageRoute(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
