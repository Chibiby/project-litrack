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
 * Every push to main that changes `src/` or `prisma/` adds an entry here and
 * bumps `package.json` in the same push (CLAUDE.md § Releases; a PreToolUse hook
 * in `.claude/settings.json` blocks the push otherwise). No migration, no admin
 * screen, no separate CHANGELOG to fall out of date.
 *
 * Semver, as this project uses it:
 *   patch  (1.2.X) the push holds only fixes
 *   minor  (1.X.0) the push holds at least one feature
 *   major  (X.0.0) only when the project owner says so
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
  // 1.2.0–1.6.0 were written on 2026-09-12, after the fact: these changes had
  // already shipped with no entry. One version per group, in the order each
  // group reached main.
  {
    version: "1.6.0",
    date: "2026-09-12",
    title: "ARAL grids: clear a row, save part of a month, reopen a window",
    announce: true,
    fixes: [
      "You can clear a row in the weekly attendance and monthly reading level grids. The row stays cleared when you press Save.",
      "The monthly reading level sheet now saves rows you have only partly filled, instead of refusing the whole page.",
      "Monthly reading levels can now have a deadline, 7 days after the month ends. It is not enforced for now.",
      "Super Admins can reopen a week, month, or term for one teacher or a whole school, for 1 to 90 days. Affected teachers are told once.",
      "Teachers who advise more than one section now pick the grade and section when they add a learner.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-09-11",
    title: "Clearer errors, and a reference code when something breaks",
    announce: true,
    fixes: [
      "When sign-in fails, LITRACK now says what went wrong. When your session ends, it says why.",
      "Error pages show a reference code you can give to support. A missing page offers a way back, and pages you cannot open say so.",
      "Super Admins can search the error log by that reference code.",
      "Visitors no longer see server configuration details on the sign-in page.",
      "The link from the login page to the admin sign-in works reliably.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-09-11",
    title: "Floating teachers and teachers who advise several sections",
    announce: true,
    fixes: [
      "Profiling asks once whether a teacher floats, advises one section, or advises several. The number of sections they may hold follows that answer.",
      "An ARAL Volunteer cannot hold an advisory section.",
      "School Heads can set a teacher's designation and advisory load, and see which sections a change unassigns before confirming.",
      "School Heads are told which sections have learners but no adviser.",
      "Removing a teacher frees their sections. The Teachers page lists the teachers who were removed.",
      "A floating teacher's class menus are closed, and say why.",
      "A teacher with no section can save their profile. A School Head can release sections a teacher holds past their limit.",
    ],
  },
  {
    version: "1.3.0",
    date: "2026-09-11",
    title: "A one-voice assistant, and School Head password recovery",
    announce: true,
    fixes: [
      "The assistant now gives one answer, instead of replacing an answer while you read it. If it cannot answer, it says so and points you to your division admin.",
      "Super Admins can view the password a School Head chose, from the school accounts console, to help a head who forgot it. Every view is recorded in the audit log.",
      "The sidebar shows “LITRACK by Apache Spark” with the version, above your profile. The account menu no longer has a second Sign out.",
    ],
  },
  {
    version: "1.2.1",
    date: "2026-09-11",
    title: "Learner form fixes",
    announce: true,
    fixes: [
      "The ethnicity you pick on the learner form no longer snaps back to “Not specified”.",
      "The profile completion bar keeps up while you type.",
      "The ethnicity add and remove links are proper buttons, and dropdown options read correctly with a screen reader.",
    ],
  },
  {
    version: "1.2.0",
    date: "2026-09-11",
    title: "Term windows each school can set",
    announce: true,
    fixes: [
      "A term can stay open for entry after its months end. School Heads set this for their own school.",
      "The grade sheet uses your school's own term deadline.",
    ],
  },
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

/**
 * The releases to show a user whose last acknowledged version is `lastSeen`,
 * newest first. Several versions can ship between two sign-ins, and the modal
 * lists every one of them once rather than only the newest.
 *
 * - Already on the current version: nothing.
 * - Never acknowledged one (`null`), a version this list does not know, or a
 *   version newer than the head (a rollback): the current release only. A new
 *   account does not need the whole history; that lives at /releases.
 * - Otherwise: every announcing release newer than `lastSeen`.
 *
 * Takes the list as a parameter so tests can pin the rules without depending on
 * the committed history.
 */
export function unseenReleases(
  lastSeen: string | null,
  releases: readonly Release[] = RELEASES
): Release[] {
  const head = releases[0];
  if (lastSeen === head.version) return [];
  const seen = lastSeen ?? "";
  const known = releases.some((r) => r.version === seen);
  if (!known || compareVersions(seen, head.version) > 0) {
    return head.announce ? [head] : [];
  }
  return releases.filter(
    (r) => r.announce && compareVersions(r.version, seen) > 0
  );
}
