"use client";

import { useEffect, useRef } from "react";

/**
 * Draft retention for an editable grid (attendance, reading levels, term
 * grades): unsaved rows are copied to this device's storage as they change and
 * put back when the same grid opens again — after a reload, an app update, a
 * dropped connection or a frozen tab.
 *
 * Rows are `Record<rowId, T>`. A draft keeps, for each changed row, the saved
 * value it started from (`base`) and the edited value. On restore a row is
 * applied only when the saved value is still the same as `base`: if someone
 * saved that row since, the server's newer value wins and the draft row is
 * dropped. Nothing is restored into a read-only (locked) grid.
 *
 * Storage failures (private mode, quota) are swallowed: the grid works exactly
 * as before, just without the safety net.
 */

const PREFIX = "litrack:draft:";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

type DraftEntry = { base: string; value: unknown };
type StoredDraft = { v: 1; at: number; rows: Record<string, DraftEntry> };

export function draftStorageKey(...parts: string[]): string {
  return PREFIX + parts.join(":");
}

function readDraft(key: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (parsed?.v !== 1 || typeof parsed.rows !== "object" || !parsed.rows) return null;
    if (Date.now() - parsed.at > MAX_AGE_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearDraft(key: string | null): void {
  if (!key) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/** Drops drafts older than 30 days. Cheap; called once per grid mount. */
function sweepOldDrafts(): void {
  try {
    const now = Date.now();
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(PREFIX)) continue;
      try {
        const d = JSON.parse(window.localStorage.getItem(k) ?? "null") as StoredDraft | null;
        if (!d || now - d.at > MAX_AGE_MS) window.localStorage.removeItem(k);
      } catch {
        window.localStorage.removeItem(k);
      }
    }
  } catch {
    // ignore
  }
}

/** Pure: the draft rows to write for `rows` against `baseline`; null when nothing differs. */
export function buildDraftRows<T>(
  baseline: Record<string, T>,
  rows: Record<string, T>,
  equal: (a: T | undefined, b: T | undefined) => boolean
): Record<string, DraftEntry> | null {
  const out: Record<string, DraftEntry> = {};
  let any = false;
  for (const id of Object.keys(rows)) {
    if (equal(baseline[id], rows[id])) continue;
    out[id] = { base: JSON.stringify(baseline[id] ?? null), value: rows[id] };
    any = true;
  }
  return any ? out : null;
}

/** Pure: which draft rows still apply to `baseline`, as a patch for `rows`. */
export function restorableRows<T>(
  baseline: Record<string, T>,
  draft: Record<string, DraftEntry>
): Record<string, T> {
  const patch: Record<string, T> = {};
  for (const [id, entry] of Object.entries(draft)) {
    if (!(id in baseline)) continue;
    if (JSON.stringify(baseline[id] ?? null) !== entry.base) continue;
    patch[id] = entry.value as T;
  }
  return patch;
}

const jsonEqual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function useGridDraft<T>({
  storageKey,
  enabled,
  baseline,
  rows,
  setRows,
  equal = jsonEqual,
  onRestored,
}: {
  /** One key per grid view (user, grade, week/month/term, section). Null turns drafts off. */
  storageKey: string | null;
  /** False for a read-only (locked) grid: no restore, no writes. */
  enabled: boolean;
  /** The last saved values. */
  baseline: Record<string, T>;
  rows: Record<string, T>;
  setRows: (update: (prev: Record<string, T>) => Record<string, T>) => void;
  equal?: (a: T | undefined, b: T | undefined) => boolean;
  /** Called once with the number of rows put back. */
  onRestored?: (count: number) => void;
}): void {
  const restoredFor = useRef<string | null>(null);
  const latest = useRef({ baseline, rows, equal, storageKey, enabled });

  // Declared first, so the effects below always read this render's values.
  useEffect(() => {
    latest.current = { baseline, rows, equal, storageKey, enabled };
  });

  // Restore once per key, after the grid's own state is seeded.
  useEffect(() => {
    if (!storageKey || !enabled || restoredFor.current === storageKey) return;
    restoredFor.current = storageKey;
    sweepOldDrafts();
    const draft = readDraft(storageKey);
    if (!draft) return;
    const patch = restorableRows(latest.current.baseline, draft.rows);
    const count = Object.keys(patch).length;
    // Nothing for this grid's rows (they may belong to another page): leave
    // the draft alone. Stale rows of this grid are dropped on the next write.
    if (count === 0) return;
    setRows((prev) => ({ ...prev, ...patch }));
    onRestored?.(count);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per key by design
  }, [storageKey, enabled]);

  // Write (debounced) whenever the rows change.
  useEffect(() => {
    if (!storageKey || !enabled) return;
    const t = setTimeout(() => writeDraft(latest.current, restoredFor.current), 250);
    return () => clearTimeout(t);
  }, [storageKey, enabled, rows, baseline]);

  // And immediately when the tab is hidden or closed: a debounce may never fire.
  useEffect(() => {
    const flush = () => writeDraft(latest.current, restoredFor.current);
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}

function writeDraft<T>(
  current: {
    storageKey: string | null;
    enabled: boolean;
    baseline: Record<string, T>;
    rows: Record<string, T>;
    equal: (a: T | undefined, b: T | undefined) => boolean;
  },
  restoredKey: string | null
): void {
  const { storageKey: key, enabled: on, baseline: base, rows, equal: eq } = current;
  if (!key || !on) return;
  // Never write before the restore has read what is there.
  if (restoredKey !== key) return;
  // Rows this grid does not hold (another page of the same month, say) keep
  // their draft entries; only this grid's rows are rewritten.
  const others: Record<string, DraftEntry> = {};
  for (const [id, entry] of Object.entries(readDraft(key)?.rows ?? {})) {
    if (!(id in rows)) others[id] = entry;
  }
  const own = buildDraftRows(base, rows, eq);
  const draftRows = own || Object.keys(others).length > 0 ? { ...others, ...(own ?? {}) } : null;
  try {
    if (!draftRows) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify({ v: 1, at: Date.now(), rows: draftRows } satisfies StoredDraft));
  } catch {
    // quota or blocked storage: keep working without the draft
  }
}
