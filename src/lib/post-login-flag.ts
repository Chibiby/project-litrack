/** sessionStorage key set by login forms before redirect; read-and-cleared by splash. */
export const POST_LOGIN_FLAG = "litrack:post-login";

/**
 * Survives React Strict Mode remount: sessionStorage is cleared on first
 * consume, so a module latch keeps the splash/bridge eligible across remount.
 */
let pendingPostLoginSplash = false;

/**
 * True until the splash has been claimed once in this document.
 *
 * A module is evaluated exactly once per document load, so this starts true on
 * every *hard* navigation — first visit, reload, Ctrl+Shift+R — and stays
 * false for the rest of the session, because soft navigations keep the same
 * bundle alive. That is the whole mechanism: no timestamps and no
 * navigation-type sniffing, just the fact that a fresh document gets a fresh
 * module.
 *
 * The effect is that the ARAL splash covers every cold entry into the app
 * rather than only the one that follows a login. It never fires on in-app
 * navigation, and never on `/login`, which mounts no splash.
 */
let bootSplashPending = true;

/** True while the splash should cover the app (boot, storage flag, or latch). */
export function isPostLoginLoadingCover(): boolean {
  if (typeof window === "undefined") return false;
  if (bootSplashPending) return true;
  try {
    if (sessionStorage.getItem(POST_LOGIN_FLAG) === "1") return true;
  } catch {
    // sessionStorage unavailable
  }
  return pendingPostLoginSplash;
}

/**
 * Claim the splash for this document.
 *
 * Read-and-clears both the boot latch and the storage flag;
 * `pendingPostLoginSplash` then keeps the answer stable across a Strict Mode
 * remount, and `clearPendingPostLoginSplash` releases it once the splash has
 * played out.
 */
export function consumePostLoginFlag(): boolean {
  if (bootSplashPending) {
    bootSplashPending = false;
    pendingPostLoginSplash = true;
  }
  try {
    if (sessionStorage.getItem(POST_LOGIN_FLAG) === "1") {
      sessionStorage.removeItem(POST_LOGIN_FLAG);
      pendingPostLoginSplash = true;
    }
  } catch {
    // sessionStorage unavailable
  }
  return pendingPostLoginSplash;
}

export function clearPendingPostLoginSplash(): void {
  pendingPostLoginSplash = false;
  bootSplashPending = false;
}
