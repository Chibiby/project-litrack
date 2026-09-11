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
    // The ten concerns raised alongside 1.0.0 — the spec calls them "the first
    // release notes", and this is the entry that announces itself. Minor, not
    // patch: several are features. Announced because they change what teachers
    // see on their ARAL pages and on the School Head's Teachers page.
    version: "1.1.0",
    date: "2026-09-11",
    title: "Up to three advisory sections, and clearer ARAL pages",
    announce: true,
    fixes: [
      "ARAL pages now list only the learners you are the designated ARAL tutor for. Learners in your class who have a different tutor stay on your Learners page.",
      "A teacher can now advise up to three sections. School Heads add and remove them on the Teachers page.",
      "A teacher without an advisory section can finish their profile by answering No to “Do you advise a classroom section?” They show as Floating on the Teachers page until one is assigned.",
      "School Heads can deactivate a grade level that was added by mistake, and restore it later. A grade that still has learners cannot be deactivated.",
      "An archived section no longer shows as a teacher's assignment.",
      "Weekly attendance and term grades have no editing deadline for now. Your division admin can switch deadlines back on.",
      "LITRACK now tells you what changed after an update. The version number at the bottom of the sidebar opens every release's notes.",
    ],
  },
  {
    version: "1.0.0",
    date: "2026-09-10",
    title: "LITRACK 1.0",
    announce: false,
    fixes: [
      "First numbered release. Everything the app does today, gathered under one version number.",
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
