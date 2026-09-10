/**
 * How many sections one teacher may advise.
 *
 * Its own module because both halves need it and neither may import the other:
 * `section-assignment.ts` enforces it inside a transaction on the server, and
 * the School Head's teachers table disables its picker at the same number.
 * `advisory.ts` and `section-assignment.ts` are server-side, so a client
 * component cannot reach the constant there.
 *
 * Three is a programme decision, not a data-integrity one, which is why it lives
 * in the action layer rather than in a database constraint — moving it must not
 * need a migration.
 */
export const MAX_ADVISORY_SECTIONS = 3;
