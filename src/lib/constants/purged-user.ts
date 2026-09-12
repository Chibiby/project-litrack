/**
 * What to show where a person's name would go, when that person's account was
 * permanently deleted from `/admin/archive`.
 *
 * Migration `20260912000001_archive_purge_recorder_setnull_and_deleted_at_indexes`
 * made the nine "who recorded this" columns nullable with `ON DELETE SET NULL`,
 * so a purge leaves the record intact and drops only its pointer to the person.
 * A `null` there means "the account was permanently deleted" — it never means
 * "nobody recorded this", because the row's existence is what records the event.
 *
 * One constant rather than a literal at each call site: these strings are read
 * side by side in the same school, and two of them drifting apart would read as
 * two different situations.
 */
export const PURGED_USER_LABEL = "Removed account";
