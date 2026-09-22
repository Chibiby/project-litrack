import { formatLocalDateKey } from "@/lib/date-keys";
import { addMonths, monthEndDay } from "@/lib/month-range";

/**
 * Term windows for the End of Terms grade sheet.
 *
 * A term is three whole months, snapped to month boundaries, counted from the
 * month the active `SchoolYear` starts in. Nothing about a window is stored: a
 * school starting in August gets Aug–Oct / Nov–Jan / Feb–Apr and one starting in
 * June gets Jun–Aug / Sep–Nov / Dec–Feb, with no seed rows, no backfill and no
 * cron to keep in sync.
 *
 * Everything here is pure and string-comparison based, so the label a teacher
 * reads and the lock the save action enforces are derived from the same two
 * functions and cannot drift.
 */

/** Ordered terms. Index is the window offset: term N starts at month N*3. */
export const TERM_PERIODS = ["FIRST", "SECOND", "THIRD"] as const;

export type TermPeriodValue = (typeof TERM_PERIODS)[number];

export type TermWindow = {
  term: TermPeriodValue;
  /** "First Term" */
  label: string;
  /** "August - October" — month names only, matching the approved sheet. */
  rangeLabel: string;
  /** Local `YYYY-MM-DD` of the first day of the window's first month. */
  startKey: string;
  /** Local `YYYY-MM-DD` of the last day of the window's last month. */
  endKey: string;
  /**
   * Local `YYYY-MM-DD` of the last day grades may be encoded. Equals `endKey`
   * for a derived window, and is the ONLY key `isTermLocked` consults, so a
   * A Super Admin can extend entry without moving the months the sheet displays.
   */
  deadlineKey: string;
  /** True when a `TermWindowOverride` row supplied this window's dates. */
  isOverridden: boolean;
};

/**
 * The shape `getTermWindows` accepts for an override.
 *
 * Declared structurally rather than imported from `@prisma/client` so this
 * module stays pure and dependency-free — a Prisma row satisfies it, and so does
 * a literal in a test.
 */
export type TermWindowOverrideInput = {
  term: TermPeriodValue;
  startKey: string;
  endKey: string;
  deadlineKey: string;
};

const TERM_LABELS: Record<TermPeriodValue, string> = {
  FIRST: "First Term",
  SECOND: "Second Term",
  THIRD: "Third Term",
};

/**
 * Hardcoded rather than taken from `Intl`, for the same reason
 * `src/lib/month-range.ts` hardcodes its own: these labels render on the server
 * and hydrate in the browser, and the two do not always ship the same ICU locale
 * data. A mismatch would be a hydration error.
 */
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * The three windows for a school year, derived from its start date.
 *
 * The anchor month is read with UTC getters, matching how `SchoolYear.startDate`
 * is written and read back everywhere else. See the comment on the read itself
 * for the full reasoning.
 *
 * This docblock previously claimed the opposite — that the month must come from
 * the LOCAL date key, on the premise that an August 1 Manila start is stored as
 * `2026-07-31T16:00:00Z`. That premise was wrong: `createSchoolYear` stores the
 * value of an `<input type="date">` via `new Date("2026-08-01")`, which
 * ECMA-262 parses as UTC midnight, and the school-year pages round-trip it with
 * `.toISOString().slice(0, 10)`. Reading local fields agreed with UTC at UTC and
 * at positive offsets, and shifted every window a month early at negative ones.
 */
export function getTermWindows(
  schoolYearStart: Date,
  overrides: TermWindowOverrideInput[] = []
): TermWindow[] {
  // The anchor month is read with UTC getters, not local ones, because that
  // is how `SchoolYear.startDate` is written and how every other reader reads
  // it back. `createSchoolYear` does `new Date("2026-08-01")` on the value of
  // an `<input type="date">`, and ECMA-262 parses a date-only ISO string as
  // UTC midnight, so the stored instant is `2026-08-01T00:00:00.000Z`. The
  // school-year pages round-trip it with `.toISOString().slice(0, 10)`.
  //
  // Reading LOCAL fields off that instant agrees with the UTC ones at UTC and
  // at every positive offset (so Cloudflare Workers, which runs UTC, and a
  // machine in Manila both got the right month), but lands on the PREVIOUS
  // day at any negative offset — a developer in the Americas saw every term,
  // and every `deadlineKey` that `isTermLocked` consults, shift a month early.
  const year = schoolYearStart.getUTCFullYear();
  const month = schoolYearStart.getUTCMonth();

  // Local midnight from here on is deliberate and safe: `anchor` is rebuilt
  // from plain integers, so the rest of this module is pure calendar
  // arithmetic over local fields and `formatLocalDateKey` round-trips it
  // exactly, in any timezone.
  const anchor = new Date(year, month, 1);

  return TERM_PERIODS.map((term, index) => {
    const override = overrides.find((o) => o.term === term);
    if (override) {
      return {
        term,
        label: TERM_LABELS[term],
        rangeLabel: rangeLabelFor(override.startKey, override.endKey),
        startKey: override.startKey,
        endKey: override.endKey,
        deadlineKey: override.deadlineKey,
        isOverridden: true,
      };
    }

    const start = addMonths(anchor, index * 3);
    const end = monthEndDay(addMonths(anchor, index * 3 + 2));
    const endKey = formatLocalDateKey(end);
    return {
      term,
      label: TERM_LABELS[term],
      rangeLabel: `${MONTH_NAMES[start.getMonth()]} - ${MONTH_NAMES[end.getMonth()]}`,
      startKey: formatLocalDateKey(start),
      endKey,
      // A derived window's deadline IS its month end. Every lock behaves exactly
      // as it did before this parameter existed until a head changes something.
      deadlineKey: endKey,
      isOverridden: false,
    };
  });
}

/**
 * "August - September" from two date keys.
 *
 * Reads the month off the KEY's own characters rather than constructing a
 * `Date`, for the reason this module's header gives: a key is already local, and
 * parsing it into a `Date` only to read `.getMonth()` reintroduces the timezone
 * question the key exists to settle.
 */
function rangeLabelFor(startKey: string, endKey: string): string {
  const startMonth = Number(startKey.slice(5, 7)) - 1;
  const endMonth = Number(endKey.slice(5, 7)) - 1;
  return `${MONTH_NAMES[startMonth]} - ${MONTH_NAMES[endMonth]}`;
}

/**
 * A term is locked once its DEADLINE has passed — inclusive on the deadline
 * itself, so a teacher encoding on the last day is still open.
 *
 * The deadline, not the months. For a derived window the two are the same day;
 * for an extended one the months describe what the sheet is called and the
 * deadline decides what may be written into it.
 *
 * `todayKey` must come from `formatLocalDateKey(schoolToday())`, never from a
 * bare `new Date()`: the server runs in UTC and the school in UTC+8, so between
 * midnight and 08:00 Manila a raw date resolves to yesterday and every term
 * would lock a day early.
 *
 * String comparison on `YYYY-MM-DD` is a total order, which sidesteps `Date`
 * arithmetic entirely.
 */
export function isTermLocked(window: TermWindow, todayKey: string): boolean {
  return todayKey > window.deadlineKey;
}

/** The window for a term string, or `null` when it names no term. */
export function resolveTermWindow(
  windows: TermWindow[],
  term: string
): TermWindow | null {
  return windows.find((w) => w.term === term) ?? null;
}

/**
 * The rule set for an administrator's edit must satisfy, or `null` when it does.
 *
 * Validated against the EFFECTIVE three windows — derived thirds with any
 * overrides already applied — never against the stored rows alone. That is what
 * makes sparse storage safe: a head who overrides only Term 2 is still checked
 * against derived Terms 1 and 3, so a partial edit cannot open a gap.
 *
 * Returns a message naming the specific violation, because "invalid dates" gives
 * a head no way to fix what they typed.
 *
 * Deadlines are deliberately exempt from the cross-term ordering rule: Term 1's
 * deadline running past Term 2's start is the feature, not a violation.
 */
export function validateTermWindows(
  windows: TermWindow[],
  yearStartKey: string,
  yearEndKey: string
): string | null {
  for (const w of windows) {
    if (w.startKey > w.endKey) {
      return `${w.label} ends before it starts.`;
    }
    if (w.deadlineKey < w.endKey) {
      return `${w.label}'s deadline is before the term ends.`;
    }
    if (w.startKey < yearStartKey) {
      return `${w.label} starts before the school year does.`;
    }
    if (w.endKey > yearEndKey) {
      return `${w.label} ends after the school year does.`;
    }
    if (w.deadlineKey > yearEndKey) {
      return `${w.label}'s deadline is after the school year does.`;
    }
  }

  for (let i = 1; i < windows.length; i++) {
    const previous = windows[i - 1];
    const current = windows[i];
    if (current.startKey <= previous.endKey) {
      return `${current.label} starts before ${previous.label} ends.`;
    }
  }

  return null;
}
