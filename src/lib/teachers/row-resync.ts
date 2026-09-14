/**
 * Keeps a School Head teacher row's client-only overrides (the advisory chips
 * shown before a `router.refresh()` lands) from being wiped by an unrelated
 * prop update — a different row saving, a page turn, a search, or a manual
 * Refresh click.
 *
 * The table used to clear every row's override whenever the `rows` prop
 * changed at all (`useEffect(() => setAdvisoryOverrides({}), [rows])`). That
 * fires on *any* refresh, not just one that actually brings this row's own
 * change back, so a still-in-flight (or simply not-yet-refreshed) edit would
 * visibly snap back to the stale value the moment some other row's save, or
 * the new Refresh button, triggered a re-render — see teachers-active-table.tsx.
 *
 * The fix compares each row's signature between renders and only drops an
 * override once *that row's own* signature has actually moved — i.e. fresh
 * server data has genuinely arrived for it.
 */

export type SignatureRow = {
  id: string;
  designation: string | null;
  advisoryMode: string | null;
  assignments: { sectionId: string }[];
};

export type RowSignatures = Record<string, string>;

/**
 * A cheap fingerprint of the fields the Role dialog and the advisory picker
 * can change. Two renders of the same row with the same signature are the
 * same server state as far as those controls are concerned, even if
 * unrelated fields (e.g. `approvedAt`) differ.
 */
export function teacherRowSignature(row: SignatureRow): string {
  const sectionIds = row.assignments
    .map((a) => a.sectionId)
    .slice()
    .sort()
    .join(",");
  return `${row.designation ?? ""}|${row.advisoryMode ?? ""}|${sectionIds}`;
}

export function signaturesFor(rows: SignatureRow[]): RowSignatures {
  const map: RowSignatures = {};
  for (const row of rows) map[row.id] = teacherRowSignature(row);
  return map;
}

/**
 * Drop a row's local override only once the server signature for that row
 * has actually changed since the last render (or the row is gone — removed,
 * deactivated, or filtered out of the current page). Every other row's
 * override, changed or not, is left untouched — a good compromise: a row
 * with no override in `overrides` never appears in the result either way, so
 * this only ever prunes, never invents, an entry.
 *
 * Returns the same `overrides` reference when nothing needs to change, so a
 * caller can skip a `setState` call and avoid a pointless re-render.
 */
export function resyncOverrides<T>(
  overrides: Record<string, T>,
  previousSignatures: RowSignatures,
  nextSignatures: RowSignatures
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [id, value] of Object.entries(overrides)) {
    const prevSig = previousSignatures[id];
    const nextSig = nextSignatures[id];
    if (nextSig === undefined || nextSig !== prevSig) {
      changed = true;
      continue;
    }
    next[id] = value;
  }
  return changed ? next : overrides;
}
