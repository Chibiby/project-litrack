"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const DEFAULT_MESSAGE =
  "You have unsaved changes. Leave this page? Your changes will be lost.";

type Snapshot = {
  isDirty: boolean;
  message: string;
};

type UnsavedChangesState = Snapshot & {
  /** Register/clear dirty state from a form guard. */
  setDirty: (dirty: boolean, message?: string) => void;
};

/**
 * Module store so header Sign out and form guards stay in sync even when a
 * Server Component `children` slot sits between provider and form (RSC boundary).
 * React context alone is not always enough for that layout shape.
 */
let storeSnapshot: Snapshot = {
  isDirty: false,
  message: DEFAULT_MESSAGE,
};
const storeListeners = new Set<() => void>();

function emitStore() {
  for (const listener of storeListeners) listener();
}

function getStoreSnapshot(): Snapshot {
  return storeSnapshot;
}

function subscribeStore(listener: () => void) {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

export function setUnsavedChangesDirty(dirty: boolean, message?: string) {
  const next: Snapshot = {
    isDirty: dirty,
    message: dirty
      ? (message ?? storeSnapshot.message ?? DEFAULT_MESSAGE)
      : DEFAULT_MESSAGE,
  };
  if (
    next.isDirty === storeSnapshot.isDirty &&
    next.message === storeSnapshot.message
  ) {
    return;
  }
  storeSnapshot = next;
  emitStore();
}

const UnsavedChangesContext = createContext<UnsavedChangesState | null>(null);

/**
 * Optional provider so header Sign out (and other leave actions) can read form dirty state.
 * Also mirrors into the module store for RSC-safe reads.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  // Re-render provider consumers when the store changes.
  const snapshot = useSyncExternalStore(
    subscribeStore,
    getStoreSnapshot,
    getStoreSnapshot
  );

  const setDirty = useCallback((dirty: boolean, nextMessage?: string) => {
    setUnsavedChangesDirty(dirty, nextMessage);
  }, []);

  const value = useMemo(
    () => ({
      isDirty: snapshot.isDirty,
      message: snapshot.message,
      setDirty,
    }),
    [snapshot.isDirty, snapshot.message, setDirty]
  );

  return (
    <UnsavedChangesContext.Provider value={value}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

/** Prefer this in chrome that must see form dirty across layout/page boundaries. */
export function useUnsavedChanges() {
  const snapshot = useSyncExternalStore(
    subscribeStore,
    getStoreSnapshot,
    getStoreSnapshot
  );
  const setDirty = useCallback((dirty: boolean, nextMessage?: string) => {
    setUnsavedChangesDirty(dirty, nextMessage);
  }, []);
  return { ...snapshot, setDirty };
}

export function useUnsavedChangesOptional() {
  return useContext(UnsavedChangesContext);
}

/**
 * Stable JSON snapshot of form values for dirty comparison.
 * Sorts object keys so key-order differences do not false-trigger dirty.
 */
export function stableSerialize(value: unknown): string {
  return JSON.stringify(value, (_, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const key of Object.keys(v as object).sort()) {
        sorted[key] = (v as Record<string, unknown>)[key];
      }
      return sorted;
    }
    return v;
  });
}
