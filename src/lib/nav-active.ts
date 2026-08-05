export type NavActiveItem = {
  href: string;
  /** When true, only pathname === href (dashboard roots). */
  exact?: boolean;
};

/** Exact match for dashboard roots; otherwise longest matching prefix wins. */
export function isNavItemActive(
  pathname: string,
  items: NavActiveItem[],
  item: NavActiveItem
): boolean {
  const pathOnly = pathname.split("?")[0] ?? pathname;
  const itemPath = item.href.split("?")[0] ?? item.href;

  if (item.exact) {
    return pathOnly === itemPath;
  }

  const matching = items.filter((i) => {
    const hrefPath = i.href.split("?")[0] ?? i.href;
    if (i.exact) return pathOnly === hrefPath;
    return pathOnly === hrefPath || pathOnly.startsWith(hrefPath + "/");
  });
  if (matching.length === 0) return false;

  const longest = matching.reduce((a, b) => {
    const aLen = (a.href.split("?")[0] ?? a.href).length;
    const bLen = (b.href.split("?")[0] ?? b.href).length;
    return aLen >= bLen ? a : b;
  });
  return longest.href === item.href;
}
