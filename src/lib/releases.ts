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
/**
 * Who a note is written for. Mirrors Prisma's `UserRole` by hand rather than
 * importing it: this module is shared with the client, and pulling
 * `@prisma/client` into it for three string literals would drag the generated
 * client into the browser bundle.
 */
export type ReleaseAudience = "SUPER_ADMIN" | "SCHOOL_HEAD" | "TEACHER";

/**
 * One line of "what changed".
 *
 * A bare string is for everybody — the default, and what nearly every note
 * should be. The object form restricts a note to the roles that can act on it,
 * and exists for one reason: a note can itself disclose something. "A Super
 * Admin can read back the password a School Head chose" tells every School Head
 * in the country that someone else can see the password they picked, which is a
 * privacy matter and not theirs to learn from a changelog. Restrict a note when
 * reading it would disclose a capability over the reader's own data; do not
 * restrict one merely because it is about a screen the reader cannot open.
 */
export type ReleaseNote =
  | string
  | { text: string; roles: readonly ReleaseAudience[] };

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
  /**
   * What changed, in the user's language, not the codebase's. Read through
   * `visibleFixes`, never directly — a restricted note must not reach a reader
   * it was not written for.
   */
  fixes: readonly ReleaseNote[];
};

/**
 * Newest first. The order is load-bearing — `APP_VERSION` is the head, and a
 * test enforces strict descending order so it cannot quietly stop being true.
 */
export const RELEASES: readonly Release[] = [
  {
    version: "1.10.0",
    date: "2026-09-12",
    title: "Support conversations now show real availability",
    announce: true,
    fixes: [
      {
        text: "Super Admins can work through school conversations and support tickets in a clearer two-pane support workspace.",
        roles: ["SUPER_ADMIN"],
      },
      "Teacher activity now appears as Online or Last online in private support conversations, without counting administrator impersonation as teacher activity.",
    ],
  },
  {
    version: "1.9.0",
    date: "2026-09-12",
    title: "A clearer account management workspace",
    announce: true,
    fixes: [
      {
        text: "Super Admins can see account totals, filter the directory, and work through account details in a clearer, more compact Accounts Management page.",
        roles: ["SUPER_ADMIN"],
      },
      "The account directory has a clearer responsive layout while keeping its existing password and troubleshooting actions.",
    ],
  },
  {
    version: "1.8.2",
    date: "2026-09-12",
    title: "Teacher roster filters and reliable term reports",
    announce: true,
    fixes: [
      "School Heads can filter the Teachers page by Non-DepEd ARAL Volunteer, Teacher, Floating, Multi advisory, or With advisory.",
      "Teachers with more than one advisory section can open End of Terms Reports from any of their advised grades without a Page not found error.",
    ],
  },
  {
    version: "1.8.1",
    date: "2026-09-12",
    title: "The account support update now appears after sign-in",
    announce: true,
    fixes: [
      "The account support update now appears in the one-time update notice after sign-in and stays available in release history after it is acknowledged.",
      {
        text: "Super Admins can find any teacher or School Head in the new Accounts console, inspect account status, reset credentials, and securely sign in as that account while troubleshooting.",
        roles: ["SUPER_ADMIN"],
      },
    ],
  },
  {
    version: "1.8.0",
    date: "2026-09-12",
    title: "Account support is now in one place",
    announce: false,
    fixes: [
      "School account support is now organized in one console, making it faster for administrators to find an account and resolve sign-in problems.",
      {
        text: "Super Admins can inspect account details, issue temporary passwords, and securely sign in as a teacher or School Head while troubleshooting.",
        roles: ["SUPER_ADMIN"],
      },
    ],
  },
  {
    version: "1.7.1",
    date: "2026-09-12",
    title: "Removing a teacher from a school now works",
    announce: true,
    fixes: [
      // Not restricted. These describe a screen only a Super Admin can open,
      // which is explicitly NOT a reason to restrict — see `ReleaseNote` above.
      // Neither note discloses a capability over anyone's own data: that an
      // administrator can remove an account is how the school already works,
      // and saying the button was broken tells a teacher nothing about
      // themselves they did not already know.
      "Removing a teacher or a learner from a school page works. The buttons have been there since the page was built, but every one of them failed with a reference code instead of removing anything — the page could not load the code behind its own forms.",
      "The Danger zone on a school page, and the database console, are fixed by the same change.",
    ],
  },
  {
    version: "1.7.0",
    date: "2026-09-12",
    title: "Removed teachers and learners now have a home, and a way out",
    announce: true,
    fixes: [
      {
        text: "Removed teachers and learners from every school now collect in one place, under Archive. You can put a row back, or delete it for good.",
        roles: ["SUPER_ADMIN"],
      },
      {
        text: "Restoring a teacher brings the record back but not the sign-in. The account cannot log in until a School Head sends a new invite, or the teacher registers again with their email. The screen says so before you restore, and again after.",
        roles: ["SUPER_ADMIN"],
      },
      {
        text: "Deleting for good says exactly what goes first — the attendance, assessments, grades and enrolments, counted. It is one row at a time, and it cannot be undone.",
        roles: ["SUPER_ADMIN"],
      },
      {
        text: "Permanently deleting a teacher leaves every attendance mark, assessment and grade they recorded in place, but the name of who recorded it is blanked and cannot be recovered. The confirmation says this before you agree to it.",
        roles: ["SUPER_ADMIN"],
      },
      {
        text: "A removed teacher whose school was deleted can still be cleaned up from the Archive, rather than sitting there refusing to go.",
        roles: ["SUPER_ADMIN"],
      },
      "Restoring a learner now puts them back in the grade and section they hold today, instead of the ones they held when they were removed.",
    ],
  },
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
      "A closed week, month, or term can be reopened for entry. Your division admin arranges it, and you are told when your own entry window reopens.",
      {
        text: "The submissions console reopens a week, month, or term for one teacher or a whole school, for 1 to 90 days, and lists and revokes the unlocks in force.",
        roles: ["SUPER_ADMIN"],
      },
      "Teachers who advise more than one section now pick the grade and section when they add a learner.",
      "The search results, the report date range and the school year suggestion are keyboard- and touch-friendly buttons like the rest of the app.",
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
      {
        text: "The error log is searchable by that reference code, on the admin console.",
        roles: ["SUPER_ADMIN"],
      },
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
      {
        // Restricted: telling every School Head that their chosen password can
        // be read back is a privacy disclosure, and a changelog is the wrong
        // place for a person to learn it. The capability itself is audited, and
        // the runbook is where a head is told how their credential is handled.
        text: "A School Head's own password can be recovered from the school accounts console when they are locked out, rather than only reset. Restricted to Super Admins, rate limited, and every reveal writes an audit row naming who viewed it.",
        roles: ["SUPER_ADMIN"],
      },
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

/**
 * The notes in a release this reader may see, in order.
 *
 * The single door to `release.fixes`. A bare-string note is for everybody; an
 * object note reaches only the roles it names. A reader whose role is unknown
 * (`null` — nothing signed in, or a role this list does not name) sees only the
 * unrestricted notes, which is the safe direction: a restricted note is
 * restricted because reading it discloses something.
 */
export function visibleFixes(
  release: Release,
  role: ReleaseAudience | null
): string[] {
  return release.fixes
    .filter((fix) => typeof fix === "string" || (role !== null && fix.roles.includes(role)))
    .map((fix) => (typeof fix === "string" ? fix : fix.text));
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
