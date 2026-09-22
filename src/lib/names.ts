/**
 * Canonical person-name formatting, shared by every write path (manual forms,
 * self-registration, and CSV import) so the same learner or teacher is stored
 * identically no matter how they were entered.
 *
 * House style, agreed with the project owner:
 * - Every word gets an initial capital, including Filipino surname particles:
 *   "dela cruz" -> "Dela Cruz", "delos santos" -> "Delos Santos".
 * - Hyphenated and apostrophised parts capitalise on both sides:
 *   "mary-jane" -> "Mary-Jane", "o'brien" -> "O'Brien".
 * - Generational suffixes written as roman numerals are upper-cased:
 *   "jose rizal iii" -> "Jose Rizal III". "jr"/"sr." title-case normally.
 * - Internal whitespace is collapsed, so "Juan   Carlos" and "Juan Carlos"
 *   can never be two different stored values.
 */

/** Strict roman numeral (1-3999). Used to spot generational suffixes. */
const ROMAN = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

/**
 * A trailing token like "III" or "IV.". Only ever applied to a token that is
 * NOT the first one: a lone "Vi" or "Di" is a given name, not a suffix, and
 * upper-casing it would be worse than leaving it alone.
 */
function isRomanSuffix(token: string): boolean {
  const bare = token.replace(/\.$/, "");
  return bare.length >= 2 && ROMAN.test(bare.toUpperCase());
}

/** Upper-case the first letter, leave the rest as the caller prepared it. */
function upperFirst(part: string): string {
  return part ? part[0]!.toUpperCase() + part.slice(1) : part;
}

/**
 * Capitalise across internal punctuation. Splitting on a captured group keeps
 * the separators in place, so "mary-jane" and "o'brien" rebuild exactly.
 */
function capitalizeParts(token: string): string {
  return token
    .split(/([-'’])/)
    .map((part, i) => (i % 2 === 1 ? part : upperFirst(part)))
    .join("");
}

/**
 * "mcdonald" -> "McDonald". Deliberately narrow: only "Mc", never "Mac", which
 * would mangle ordinary given names like "Macario".
 */
function applyMcPrefix(token: string): string {
  const m = /^Mc([a-z])(.*)$/.exec(token);
  return m ? `Mc${m[1]!.toUpperCase()}${m[2]}` : token;
}

/**
 * Format a person name for storage and display.
 * Returns "" for empty/whitespace input so callers can treat it as absent.
 */
export function formatPersonName(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, " ");
  if (!collapsed) return "";

  return collapsed
    .split(" ")
    .map((token, index) => {
      if (index > 0 && isRomanSuffix(token)) return token.toUpperCase();
      return applyMcPrefix(capitalizeParts(token.toLowerCase()));
    })
    .join(" ");
}

/** Same as `formatPersonName`, but undefined-in / undefined-out for optionals. */
export function formatOptionalPersonName(
  raw: string | null | undefined
): string | undefined {
  if (raw == null) return undefined;
  const formatted = formatPersonName(raw);
  return formatted.length > 0 ? formatted : undefined;
}

/** Trim and collapse internal whitespace without touching letter case. */
export function collapseWhitespace(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/**
 * Free-text place and organisation names (school, region, division, district,
 * address). Case is left exactly as typed — "Region XI" and "Sample Central ES"
 * both break under title-casing — but spacing is canonicalised so the same name
 * cannot be stored two ways.
 */
export function formatOptionalLabel(
  raw: string | null | undefined
): string | undefined {
  if (raw == null) return undefined;
  const collapsed = collapseWhitespace(String(raw));
  return collapsed.length > 0 ? collapsed : undefined;
}

/** Join name parts into the denormalized `fullName` column. */
export function buildFullName(
  firstName: string,
  middleName: string | null | undefined,
  lastName: string
): string {
  return [firstName, middleName, lastName].filter(Boolean).join(" ");
}

/**
 * DepEd paperwork (report cards, class lists, honor rolls) reads names
 * surname-first: "Dela Cruz, Juan Miguel". This is a display-only transform —
 * the stored `fullName` column keeps its "Firstname Middlename Lastname"
 * shape, because search, CSV import and dedupe depend on that value staying
 * put. Build the listing form from the separate `firstName`/`middleName`/
 * `lastName` columns, never by parsing `fullName` apart: a surname like
 * "Dela Cruz" would be split on the wrong word.
 *
 * A blank/whitespace-only middle name collapses to "Lastname, Firstname"
 * with no trailing space and no stray comma. A blank `lastName` is a known
 * legacy-data gap (rows created before lastName was required); rather than
 * emit a leading comma for nothing, this falls back to the given name alone
 * with no comma at all.
 */
export function formatListingName(
  firstName: string,
  middleName: string | null | undefined,
  lastName: string
): string {
  const last = collapseWhitespace(lastName);
  const given = [collapseWhitespace(firstName), middleName ? collapseWhitespace(middleName) : ""]
    .filter(Boolean)
    .join(" ");

  if (!last) return given;
  return given ? `${last}, ${given}` : last;
}

/**
 * Convenience sibling for the common call site: spreading a Prisma row
 * (`Learner`, `Teacher`, ...) that already has `firstName`/`middleName`/
 * `lastName` as named fields. `formatListingName` stays the positional,
 * order-sensitive primitive; this is the obvious entry point for table
 * cells and export rows built straight from a row object, since it can't be
 * miscalled with two arguments swapped the way three same-typed positional
 * strings can.
 */
export function formatListingNameFromRecord(record: {
  firstName: string;
  middleName?: string | null;
  lastName: string;
}): string {
  return formatListingName(record.firstName, record.middleName, record.lastName);
}
