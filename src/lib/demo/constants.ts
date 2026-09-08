/**
 * The one demonstration tenant, as the ARAL training video refers to it.
 *
 * These strings are deliberately literal — the training script and the recorded
 * screen must read the same, so the district and school names are exactly
 * "[demo district]" and "[demo school]", square brackets included, and the
 * School ID is exactly "123456". Changing any of them desynchronises the video
 * from the app, so treat them as fixed copy rather than configuration.
 *
 * Pure constants only: no Prisma, no `server-only`, so the login form and the
 * admin settings client component can both import them.
 */

/** District name, verbatim. Shown in the login District dropdown. */
export const DEMO_DISTRICT_NAME = "[demo district]";

/** School name, verbatim. Shown in the login School dropdown. */
export const DEMO_SCHOOL_NAME = "[demo school]";

/**
 * School ID. Doubles as the School Head's first-login password — that is the
 * system-wide rule for a freshly created school (see `createSchool`), and the
 * video teaches it, so the demo must not be a special case.
 */
export const DEMO_SCHOOL_ID_CODE = "123456";

/**
 * What the demo School Head's synthetic email is derived from, instead of the
 * School ID.
 *
 * The demo is allowed to share `123456` with a real school, but a login address
 * cannot be shared: `User.email` is unique and Supabase Auth rejects a duplicate
 * outright. `schoolHeadSyntheticEmail` builds `sh@<code>.<domain>`, so deriving
 * the demo's address from the bare School ID would collide with the real
 * school's School Head the moment both exist. Prefixing keeps it distinct —
 * `sh@demo-123456.<domain>` — while staying a synthetic address, so the demo
 * account is correctly barred from email password recovery like every other one.
 *
 * This is invisible during the recording: the login page asks for a district and
 * a school, never an email.
 */
export const DEMO_EMAIL_CODE = `demo-${DEMO_SCHOOL_ID_CODE}`;

export const DEMO_REGION = "[demo region]";
export const DEMO_DIVISION = "[demo division]";
export const DEMO_ADDRESS = "[demo address]";

/**
 * The SystemSetting key holding the on/off switch. Absent row means "off" —
 * a database that has never seen the demo settings page must not expose a demo
 * school on the public login page.
 */
export const DEMO_ENABLED_KEY = "demo.enabled";
