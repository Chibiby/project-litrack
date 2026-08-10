/** sessionStorage key set by login forms before redirect; read-and-cleared by splash. */
export const POST_LOGIN_FLAG = "litrack:post-login";

/**
 * Survives React Strict Mode remount: sessionStorage is cleared on first
 * consume, so a module latch keeps the splash/bridge eligible across remount.
 */
let pendingPostLoginSplash = false;

/** True while post-login splash should cover the app (storage flag or latch). */
export function isPostLoginLoadingCover(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (sessionStorage.getItem(POST_LOGIN_FLAG) === "1") return true;
  } catch {
    // sessionStorage unavailable
  }
  return pendingPostLoginSplash;
}

/** Read-and-clear storage flag; latch survives Strict Mode remount. */
export function consumePostLoginFlag(): boolean {
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
}
