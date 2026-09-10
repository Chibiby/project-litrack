/**
 * The `SystemSetting` key behind submission locking.
 *
 * Its own module, not a constant inside `system-settings.ts` or `grants.ts`:
 * both of those are `server-only`, and the settings page that renders the switch
 * has to name the same key. One string, one place, so the reader, the writer and
 * the audit row cannot drift.
 *
 * `SystemSetting` is untyped by design, which is the whole reason this switch
 * costs no migration.
 */
export const SUBMISSION_LOCKING_KEY = "submissions.locking";
