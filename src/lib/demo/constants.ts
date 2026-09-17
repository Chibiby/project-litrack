/**
 * The demonstration tenant, as the ARAL training video refers to it.
 *
 * These strings are deliberately literal — the training script and the recorded
 * screen must read the same, so the district is exactly "[demo district]", the
 * school is "[demo school 1]", square brackets included,
 * and the School ID is exactly "123456". Changing any of them desynchronises the
 * video from the app, so treat them as fixed copy rather than configuration.
 *
 * Pure constants only: no Prisma, no `server-only`, so the login form and the
 * admin settings client component can both import them.
 */

/** District name, verbatim. Shown in the login District dropdown. */
export const DEMO_DISTRICT_NAME = "[demo district]";

/**
 * School ID of the demo school. Doubles as its School Head's first-login
 * password — that is the system-wide rule for a freshly created school (see
 * `createSchool`), and the video teaches it, so the demo must not be a special
 * case.
 *
 * A real school may already own this ID; the demo school can still carry it
 * only because the unique index on `School.schoolIdCode` is partial
 * (`WHERE "isDemo" = false`).
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
   * `sh@123456.<domain>`. `User.email` is unique and Supabase Auth rejects
   * duplicates outright, so the demo school needs its own address:
   * `sh@demo-1-123456.<domain>`.
   *
   * Still a synthetic address, so these accounts stay correctly barred from
   * email password recovery. Invisible during the recording either way: the
   * login page asks for a district and a school, never an email.
   */
  emailCode: string;
};

/**
 * The one demo school, in `DEMO_DISTRICT_NAME`.
 *
 * One, not three (project owner, 2026-09-17, docs/test-lab-spec.md): Page Test
 * Lab works inside a single demo school. Schools 2 and 3 from earlier releases
 * are removed only when an admin clicks "Reset test data" — `resetDemoTenant`
 * deletes every `isDemo` school and rebuilds this list. No code path deletes
 * them automatically.
 */
export const DEMO_SCHOOLS: readonly [DemoSchoolSpec] = [
  {
    key: "1",
    name: "[demo school 1]",
    emailCode: `demo-1-${DEMO_SCHOOL_ID_CODE}`,
  },
];

export const DEMO_REGION = "[demo region]";
export const DEMO_DIVISION = "[demo division]";
export const DEMO_ADDRESS = "[demo address]";

/**
 * The SystemSetting key holding the on/off switch. Absent row means "off" —
 * a database that has never seen the demo settings page must not expose demo
 * schools on the public login page.
 */
export const DEMO_ENABLED_KEY = "demo.enabled";
