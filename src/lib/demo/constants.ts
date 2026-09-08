/**
 * The demonstration tenant, as the ARAL training video refers to it.
 *
 * These strings are deliberately literal — the training script and the recorded
 * screen must read the same, so the district is exactly "[demo district]", the
 * schools are "[demo school 1]" … "[demo school 3]", square brackets included,
 * and the School ID is exactly "123456". Changing any of them desynchronises the
 * video from the app, so treat them as fixed copy rather than configuration.
 *
 * Pure constants only: no Prisma, no `server-only`, so the login form and the
 * admin settings client component can both import them.
 */

/** District name, verbatim. Shown in the login District dropdown. */
export const DEMO_DISTRICT_NAME = "[demo district]";

/**
 * School ID, shared by all three demo schools. Doubles as each School Head's
 * first-login password — that is the system-wide rule for a freshly created
 * school (see `createSchool`), and the video teaches it, so the demo must not be
 * a special case.
 *
 * All three carrying the same ID is possible only because the unique index on
 * `School.schoolIdCode` is partial (`WHERE "isDemo" = false`). It keeps one
 * password to remember on camera, and keeps the video's "one-two-three-four-
 * five-six" line true whichever demo school the presenter picks.
 */
export const DEMO_SCHOOL_ID_CODE = "123456";

export type DemoSchoolSpec = {
  /** Stable identifier for this school within the demo set. Never shown. */
  key: string;
  /** School name, verbatim. Shown in the login School dropdown. */
  name: string;
  /**
   * What this school's School Head synthetic email is derived from, instead of
   * the School ID.
   *
   * Two reasons it cannot be the bare School ID. A real school may already own
   * 123456 — one does — and its School Head is then already
   * `sh@123456.<domain>`. And all three demo schools share the ID, so they would
   * collide with each other as well. `User.email` is unique and Supabase Auth
   * rejects duplicates outright, so each school needs its own address:
   * `sh@demo-1-123456.<domain>`, `sh@demo-2-123456.<domain>`, and so on.
   *
   * Still a synthetic address, so these accounts stay correctly barred from
   * email password recovery. Invisible during the recording either way: the
   * login page asks for a district and a school, never an email.
   */
  emailCode: string;
};

/**
 * The three demo schools, all in `DEMO_DISTRICT_NAME`.
 *
 * Three rather than one so the recording can show the School dropdown actually
 * containing a list to scroll, which is what the video narrates, instead of a
 * single entry that makes the district filter look pointless.
 */
export const DEMO_SCHOOLS: readonly DemoSchoolSpec[] = ["1", "2", "3"].map((key) => ({
  key,
  name: `[demo school ${key}]`,
  emailCode: `demo-${key}-${DEMO_SCHOOL_ID_CODE}`,
}));

export const DEMO_REGION = "[demo region]";
export const DEMO_DIVISION = "[demo division]";
export const DEMO_ADDRESS = "[demo address]";

/**
 * The SystemSetting key holding the on/off switch. Absent row means "off" —
 * a database that has never seen the demo settings page must not expose demo
 * schools on the public login page.
 */
export const DEMO_ENABLED_KEY = "demo.enabled";
