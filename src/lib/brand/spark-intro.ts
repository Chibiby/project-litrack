/**
 * Shared constants for the Apache Spark first-load intro.
 *
 * Split out of the components so the blocking head script, the player and any
 * test can agree on the flag, the cover element and the entry routes without
 * one of them drifting. Values are inlined into a string of JavaScript, so
 * keep them JSON-serialisable.
 */

/** sessionStorage key — the intro plays once per browser tab. */
export const SPARK_INTRO_FLAG = "litrack:spark-intro";

/** Marks the cover element so the head script and the player can find it. */
export const SPARK_INTRO_COVER_ATTR = "data-spark-intro-cover";

/** `window` property the head script sets when the intro is claimed. */
export const SPARK_INTRO_WINDOW_KEY = "__litrackSparkIntro";

/** Apache Spark "paper" — the preloader's own background, so cover → intro is seamless. */
export const SPARK_PAPER = "#F2EFE8";

/** Public path of the brand-supplied, dependency-free preloader. */
export const SPARK_PRELOADER_SRC = "/brand/apache-spark/spark-preloader.js";

/**
 * Where the intro is allowed to play: the site's entry points only.
 *
 * `/` redirects to `/login`, and both login screens are the first thing a
 * visitor sees. Deliberately excludes the app routes, which have their own
 * full-screen opener in `PostLoginSplash` — two 3–4s overlays stacked on one
 * hard navigation is the failure mode this list exists to prevent.
 */
export const SPARK_INTRO_PATHS = ["/", "/login", "/admin/login"] as const;

/**
 * Longest the cover may survive on its own.
 *
 * The preloader runs 4s and self-guards, but the cover is painted before the
 * bundle exists — if that request never lands, nothing else would take the
 * page back. Comfortably past the intro so it never truncates a real play.
 */
export const SPARK_INTRO_COVER_TIMEOUT_MS = 7000;
