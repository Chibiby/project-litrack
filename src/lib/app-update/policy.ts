/**
 * When an open tab may reload itself to pick up a newer version of LITRACK.
 *
 * Never while anything typed is unsaved. A hidden tab reloads at once: nobody
 * is looking. A visible tab waits until the person has been idle for a while
 * and is not in a field or a dialog, so the reload never lands mid-task.
 * Pure, so the rules are tested without a browser.
 */
export const VISIBLE_IDLE_MS = 45_000;

export type UpdateState = {
  /** A newer deployment is live than the one this tab runs. */
  updateReady: boolean;
  hidden: boolean;
  unsavedWork: boolean;
  /** Focus in a field, or a dialog open. */
  busy: boolean;
  idleMs: number;
};

export function shouldReloadForUpdate(state: UpdateState): boolean {
  if (!state.updateReady || state.unsavedWork) return false;
  if (state.hidden) return true;
  return !state.busy && state.idleMs >= VISIBLE_IDLE_MS;
}

/** True when the version file names a deployment other than this tab's. */
export function isNewerDeployment(current: string | undefined, served: unknown): boolean {
  if (!current) return false;
  if (typeof served !== "object" || served === null) return false;
  const id = (served as { deploymentId?: unknown }).deploymentId;
  return typeof id === "string" && id.length > 0 && id !== current;
}
