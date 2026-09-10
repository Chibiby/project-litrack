/**
 * What version this app is, and what changed in each one.
 *
 * This file is the source of truth. `package.json` mirrors it and a test in
 * `tests/unit/releases.test.ts` fails if the two drift, because the version a
 * user is shown and the version npm reports must be the same string.
 *
 * Deliberately NOT `server-only`: the "what's new" modal is a client component
 * and reads the same array the server does. There is nothing here but committed
 * copy — no I/O, no secrets — so both sides sharing it is safe and keeps one
 * list rather than two that can disagree.
 *
 * Bumping a version means adding an entry here in the same commit as the work.
 * No migration, no admin screen, no separate CHANGELOG to fall out of date.
 *
 * Semver, as this project uses it:
 *   patch  a bundle of fixes
 *   minor  a feature
 *   major  a revision that changes how the app is used
 */
export type Release = {
  /** Semver, no leading "v". */
  version: string;
  /** `YYYY-MM-DD`. Local calendar date of the release, not a timestamp. */
  date: string;
  /** One line, sentence case. */
  title: string;
  /**
   * Whether to interrupt the user with the modal.
   *
   * Independent of the semver level on purpose. "Big revision" is an editorial
   * judgement, not an arithmetic one: a patch that changes what a teacher sees
   * on Monday may deserve the modal, and a minor that only touches the admin
   * console may not. Decided per release.
   */
  announce: boolean;
  /** What changed, in the user's language, not the codebase's. */
  fixes: string[];
};

/**
 * Newest first. The order is load-bearing — `APP_VERSION` is the head, and a
 * test enforces strict descending order so it cannot quietly stop being true.
 */
export const RELEASES: readonly Release[] = [
  {
    version: "1.0.0",
    date: "2026-09-10",
    title: "LITRACK 1.0",
    announce: false,
    fixes: [
      "First numbered release. Everything the app does today, gathered under one version number.",
      "You can see which version you are running in the sidebar, and what changed on the Releases page.",
    ],
  },
];

/** The version the running app reports. Mirrored in `package.json`. */
export const APP_VERSION = RELEASES[0].version;

/**
 * Compare two semver strings numerically.
 *
 * Written out rather than pulled from a library because string comparison gets
 * this wrong in a way that looks right: `"1.0.10" < "1.0.9"` as strings, so a
 * tenth patch would sort behind the ninth and the modal would stop firing.
 *
 * Returns negative when `a` is older, positive when `a` is newer, 0 when equal.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** The release the app is currently running. */
export function latestRelease(): Release {
  return RELEASES[0];
}
