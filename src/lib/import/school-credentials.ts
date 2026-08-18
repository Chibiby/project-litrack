import type { ParsedSchoolRow } from "@/lib/import/school-roster";

/**
 * Substituted when the roster has no usable School ID. Six characters, so it
 * satisfies Supabase's password minimum. Weak by design and acceptable only
 * because `mustChangePassword: true` forces replacement at first sign-in.
 */
export const PLACEHOLDER_SCHOOL_ID = "123456";

export type CredentialAssignment = {
  sourceRow: number;
  name: string;
  district?: string;
  region?: string;
  division?: string;
  address?: string;
  /** Bare shared DepEd id — what the head types. Never suffixed. */
  password: string;
  /** Unique stored code; `-N` suffix only on collision. Drives the synthetic email. */
  schoolIdCode: string;
  suffixed: boolean;
  placeholder: boolean;
};

export type AssignmentResult = {
  assignments: CredentialAssignment[];
  conflicts: { value: string; sourceRows: number[] }[];
};

/**
 * Splits the roster's School ID into the two values it has to serve at once.
 *
 *  - `password`  — the bare id printed on the DepEd sheet, shared by every school
 *                  in a collision group. Sharing is safe: `loginSchoolHead` resolves
 *                  the account from the selected `School.id`, not from the password.
 *  - `schoolIdCode` — unique per school, because it is `@unique` in Prisma and
 *                  `schoolHeadSyntheticEmail` turns it into the Supabase login address.
 *                  Only the second and later rows of a group take a `-N` suffix.
 *
 * Suffixes are assigned by ascending source row, so re-running against the same
 * sheet always produces the same codes.
 */
export function assignSchoolCredentials(rows: ParsedSchoolRow[]): AssignmentResult {
  const groups = new Map<string, ParsedSchoolRow[]>();

  for (const row of rows) {
    const base = row.schoolIdCode ?? PLACEHOLDER_SCHOOL_ID;
    const list = groups.get(base);
    if (list) list.push(row);
    else groups.set(base, [row]);
  }

  const assignments: CredentialAssignment[] = [];

  for (const [base, members] of groups) {
    const ordered = [...members].sort((a, b) => a.sourceRow - b.sourceRow);
    ordered.forEach((row, index) => {
      assignments.push({
        sourceRow: row.sourceRow,
        name: row.name,
        district: row.district,
        region: row.region,
        division: row.division,
        address: row.address,
        password: base,
        schoolIdCode: index === 0 ? base : `${base}-${index + 1}`,
        suffixed: index > 0,
        placeholder: row.schoolIdCode === null,
      });
    });
  }

  assignments.sort((a, b) => a.sourceRow - b.sourceRow);

  // Two things can still collide and neither is safe to guess at:
  //   1. A generated suffix landing on an id that genuinely exists in the sheet.
  //   2. Two distinct codes folding to one synthetic email — `schoolHeadSyntheticEmail`
  //      lowercases and rewrites every non [a-z0-9-] character, so "AB_1" and "AB-1"
  //      become the same address and the second createUser would fail mid-run.
  // Both are surfaced as conflicts and stop the import before anything is written.
  const emailKey = (code: string) => code.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const byKey = new Map<string, { value: string; sourceRows: number[] }>();
  for (const a of assignments) {
    const key = emailKey(a.schoolIdCode);
    const hit = byKey.get(key);
    if (hit) hit.sourceRows.push(a.sourceRow);
    else byKey.set(key, { value: a.schoolIdCode, sourceRows: [a.sourceRow] });
  }

  const conflicts = [...byKey.values()].filter((c) => c.sourceRows.length > 1);

  return { assignments, conflicts };
}
