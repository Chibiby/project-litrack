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

/**
 * The `SystemSetting` key behind the programme-wide "reading level unlocked for
 * everyone" switch.
 *
 * Same reasoning as `SUBMISSION_LOCKING_KEY` above, and the same reason it lives
 * in its own non-`server-only` module rather than beside its reader: the
 * settings page that renders the switch and the reader/writer in
 * `system-settings.ts` / `grants.ts` all have to name the same key without
 * importing a `server-only` module from client-adjacent code.
 */
export const READING_LEVEL_UNLOCK_ALL_KEY = "submissions.readingLevelUnlockAll";
